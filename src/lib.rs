use std::str::FromStr;

use bitcoin::{
    absolute,
    hashes::Hash,
    opcodes::all::OP_CHECKSIG,
    script::Builder,
    sighash::{Prevouts, SighashCache},
    taproot::{LeafVersion, NodeInfo, TaprootSpendInfo},
    Address, Amount, Network, ScriptBuf, TapLeafHash, TapNodeHash, TapSighashType, Transaction,
    TxOut, XOnlyPublicKey,
};
use secp256k1::{Keypair, Message, Secp256k1};
use wasm_bindgen::{prelude::wasm_bindgen, JsValue};

pub fn mint(
    pubkey: XOnlyPublicKey,
    amount: u64,
    destination_address: bitcoin::Address,
    fee: u64,
    inputs: Vec<bitcoin::TxIn>,
    prev_txouts: Vec<TxOut>,
    spend_info: TaprootSpendInfo,
    keypair: Keypair,
) -> Result<Transaction, bitcoin::taproot::TaprootBuilderError> {
    let secp = Secp256k1::new();

    let mut tx_outs = Vec::new();
    tx_outs.push(TxOut {
        value: Amount::from_sat(amount - fee),
        script_pubkey: destination_address.script_pubkey(),
    });

    let mut unsigned_tx: Transaction = Transaction {
        version: bitcoin::transaction::Version(2),
        lock_time: absolute::LockTime::ZERO,
        input: inputs,
        output: tx_outs,
    };

    let spend_script = spend_script(pubkey.into());

    let unsigned_tx_clone = unsigned_tx.clone();

    let tap_leaf_hash = TapLeafHash::from_script(&spend_script, LeafVersion::TapScript);

    for input in unsigned_tx.input.iter_mut() {
        let sighash = SighashCache::new(&unsigned_tx_clone)
            .taproot_script_spend_signature_hash(
                0,
                &Prevouts::All(&prev_txouts),
                tap_leaf_hash,
                TapSighashType::Default,
            )
            .expect("failed to construct sighash");

        let message = Message::from(sighash);
        let sig = secp.sign_schnorr_no_aux_rand(&message, &keypair);
        let script_ver = (spend_script.clone(), LeafVersion::TapScript);
        let ctrl_block = spend_info.control_block(&script_ver).unwrap();

        input.witness.push(sig.serialize());
        input.witness.push(script_ver.0.into_bytes());
        input.witness.push(ctrl_block.serialize());
    }
    Ok(unsigned_tx)
}

#[wasm_bindgen]
pub fn create_deposit_address(
    pubkey_hex: &str,
    payload_bytes: Vec<u8>,
) -> Result<Box<[u8]>, JsValue> {
    let secp = Secp256k1::new();
    let pubkey =
        XOnlyPublicKey::from_str(pubkey_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let script = spend_script(pubkey);

    let mut root_node = NodeInfo::new_leaf_with_ver(script.clone(), LeafVersion::TapScript);

    let merkle_path = build_merkle_path_from_bytes(&payload_bytes);

    for sibling_hash in &merkle_path {
        let sibling_node = NodeInfo::new_hidden_node(*sibling_hash);
        root_node = NodeInfo::combine(root_node, sibling_node)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
    }

    let taproot_spend_info = TaprootSpendInfo::from_node_info(&secp, pubkey, root_node);

    let address = Address::p2tr_tweaked(taproot_spend_info.output_key(), Network::Bitcoin);

    Ok(address.to_string().into_bytes().into_boxed_slice())
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
