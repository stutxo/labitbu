use std::str::FromStr;

use bitcoin::{
    absolute,
    hashes::{sha256, Hash, HashEngine},
    opcodes::all::OP_CHECKSIG,
    script::Builder,
    taproot::{LeafVersion, NodeInfo, TaprootSpendInfo},
    Address, Amount, Network, Psbt, ScriptBuf, TapNodeHash, TapSighashType, Transaction, TxIn,
    TxOut, XOnlyPublicKey,
};
use secp256k1::Secp256k1;
use serde_wasm_bindgen;
use wasm_bindgen::{prelude::wasm_bindgen, JsValue};

#[wasm_bindgen]
pub fn mint(
    pubkey_hex: &str,
    payload_bytes: Vec<u8>,
    amount: u64,
    destination_address: String,
    fee: u64,
    inputs: JsValue,
    prev_txouts: JsValue,
) -> Result<Box<[u8]>, JsValue> {
    let pubkey =
        XOnlyPublicKey::from_str(pubkey_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let inputs: Vec<TxIn> = serde_wasm_bindgen::from_value(inputs)
        .map_err(|e| JsValue::from_str(&format!("inputs: {}", e)))?;
    let prev_txouts: Vec<TxOut> = serde_wasm_bindgen::from_value(prev_txouts)
        .map_err(|e| JsValue::from_str(&format!("prev_txouts: {}", e)))?;
    XOnlyPublicKey::from_str(pubkey_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let taproot_spend_info = create_taproot_spend_info(pubkey, payload_bytes)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let destination_address =
        Address::from_str(&destination_address).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut tx_outs = Vec::new();
    tx_outs.push(TxOut {
        value: Amount::from_sat(amount - fee),
        script_pubkey: destination_address
            .require_network(Network::Bitcoin)
            .map_err(|e| JsValue::from_str(&e.to_string()))?
            .script_pubkey(),
    });

    let unsigned_tx: Transaction = Transaction {
        version: bitcoin::transaction::Version(2),
        lock_time: absolute::LockTime::ZERO,
        input: inputs,
        output: tx_outs,
    };

    let mut psbt =
        Psbt::from_unsigned_tx(unsigned_tx).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let spend_script = spend_script(pubkey);
    let labitbu_nums = nums_from_tag(b"Labitbu");
    let ctrl_block = taproot_spend_info
        .control_block(&(spend_script.clone(), LeafVersion::TapScript))
        .expect("control block must exist");
    let sighash_ty = TapSighashType::Default.into();

    for (psbt_in, prev_txout) in psbt.inputs.iter_mut().zip(prev_txouts.into_iter()) {
        psbt_in.witness_utxo = Some(prev_txout);
        psbt_in.tap_internal_key = Some(labitbu_nums);
        psbt_in.tap_scripts.insert(
            ctrl_block.clone(),
            (spend_script.clone(), LeafVersion::TapScript),
        );
        psbt_in.sighash_type = Some(sighash_ty);
    }

    Ok(psbt.serialize().into_boxed_slice())
}

#[wasm_bindgen]
pub fn create_deposit_address(
    pubkey_hex: &str,
    payload_bytes: Vec<u8>,
) -> Result<Box<[u8]>, JsValue> {
    let pubkey =
        XOnlyPublicKey::from_str(pubkey_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let taproot_spend_info = create_taproot_spend_info(pubkey, payload_bytes)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let address = Address::p2tr_tweaked(taproot_spend_info.output_key(), Network::Bitcoin);

    Ok(address.to_string().into_bytes().into_boxed_slice())
}

pub fn create_taproot_spend_info(
    pubkey: XOnlyPublicKey,
    payload_bytes: Vec<u8>,
) -> Result<TaprootSpendInfo, bitcoin::taproot::TaprootBuilderError> {
    let secp = Secp256k1::new();

    let spend_script = spend_script(pubkey);

    // To identify the labitbu collection we use a "Nothing Up My Sleeve" (NUMS) public key. This can not be spent
    let labitbu_nums = nums_from_tag(b"Labitbu");

    let mut root_node = NodeInfo::new_leaf_with_ver(spend_script.clone(), LeafVersion::TapScript);

    let merkle_path = build_merkle_path_from_bytes(&payload_bytes);

    for sibling_hash in &merkle_path {
        let sibling_node = NodeInfo::new_hidden_node(*sibling_hash);
        root_node = NodeInfo::combine(root_node, sibling_node)?;
    }

    Ok(TaprootSpendInfo::from_node_info(
        &secp,
        labitbu_nums,
        root_node,
    ))
}

fn nums_from_tag(tag: &[u8]) -> XOnlyPublicKey {
    let mut ctr = 0u32;
    loop {
        let mut eng = sha256::Hash::engine();
        eng.input(tag);
        eng.input(&ctr.to_le_bytes());
        let candidate = sha256::Hash::from_engine(eng);

        if let Ok(pk) = XOnlyPublicKey::from_slice(&candidate[..]) {
            return pk;
        }
        ctr += 1;
    }
}

fn build_merkle_path_from_bytes(bytes: &[u8]) -> Vec<TapNodeHash> {
    let mut padded = bytes.to_vec();
    while padded.len() % 32 != 0 {
        padded.push(0);
    }

    padded
        .chunks(32)
        .map(|chunk| TapNodeHash::from_byte_array(chunk.try_into().unwrap()))
        .collect()
}

pub fn spend_script(pubkey: XOnlyPublicKey) -> ScriptBuf {
    Builder::new()
        .push_x_only_key(&pubkey)
        .push_opcode(OP_CHECKSIG)
        .into_script()
}
