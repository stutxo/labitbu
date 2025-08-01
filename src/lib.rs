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
use image_webp::{ColorType, EncoderParams, WebPEncoder};
use rand::{rngs::SmallRng, RngCore, SeedableRng};
use secp256k1::Secp256k1;
use serde_wasm_bindgen::{self, from_value};
use wasm_bindgen::{prelude::wasm_bindgen, JsValue};

use hex::FromHex;
use image::RgbaImage;

#[wasm_bindgen]
pub fn generate_labitbu_bytes(
    pubkey_hex: &str,
    base_images_js: JsValue,
    accessories_js: JsValue,
) -> Result<Box<[u8]>, JsValue> {
    const TARGET_SIZE: usize = 4096;

    let base_images: Vec<Vec<u8>> = from_value(base_images_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse base images: {}", e)))?;
    let accessories: Vec<Vec<u8>> = from_value(accessories_js)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse accessories: {}", e)))?;

    if base_images.is_empty() {
        return Err(JsValue::from_str("No base images provided"));
    }

    let mut rng = create_rng_from_pubkey(pubkey_hex)?;

    let base_idx = (rng.next_u32() as usize) % base_images.len();
    let base_image_data = &base_images[base_idx];

    let mut base_img = image::load_from_memory(base_image_data)
        .map_err(|e| JsValue::from_str(&format!("Failed to load base image: {}", e)))?
        .to_rgba8();

    let accessory_idx = if !accessories.is_empty() {
        let roll = (rng.next_u32() as usize) % (accessories.len() + 1);
        if roll < accessories.len() {
            Some(roll)
        } else {
            None
        }
    } else {
        None
    };

    let hue_shift = (rng.next_u32() % 360) as f32;

    apply_hue_shift(&mut base_img, hue_shift);

    if let Some(acc_idx) = accessory_idx {
        let accessory_data = &accessories[acc_idx];
        let accessory_img = image::load_from_memory(accessory_data)
            .map_err(|e| JsValue::from_str(&format!("Failed to load accessory: {}", e)))?
            .to_rgba8();

        composite_images(&mut base_img, &accessory_img);
    }

    let webp_data = encode_to_webp_deterministic(&base_img)?;

    if webp_data.len() >= TARGET_SIZE {
        return Err(JsValue::from_str(&format!(
            "Generated image is {} bytes - exceeds 4096 B cap",
            webp_data.len()
        )));
    }

    let mut padded = vec![0u8; TARGET_SIZE];
    padded[..webp_data.len()].copy_from_slice(&webp_data);

    Ok(padded.into_boxed_slice())
}

fn create_rng_from_pubkey(pubkey_hex: &str) -> Result<SmallRng, JsValue> {
    let pubkey_bytes = <[u8; 32]>::from_hex(pubkey_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hex: {}", e)))?;

    let mut engine = sha256::Hash::engine();
    engine.input(&pubkey_bytes);
    let hash = sha256::Hash::from_engine(engine);
    let seed_bytes: [u8; 32] = hash.to_byte_array();

    Ok(SmallRng::seed_from_u64(u64::from_le_bytes(
        seed_bytes[..8].try_into().unwrap(),
    )))
}

fn apply_hue_shift(img: &mut RgbaImage, hue_shift: f32) {
    for pixel in img.pixels_mut() {
        let [r, g, b, a] = pixel.0;
        if a == 0 || (r > 240 && g > 240 && b > 240) {
            continue;
        }

        let (h, s, l) = rgb_to_hsl(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
        let new_h = (hue_shift + h) % 360.0;
        let new_s = s.max(0.6);
        let (new_r, new_g, new_b) = hsl_to_rgb(new_h, new_s, l);

        pixel.0 = [
            (new_r * 255.0) as u8,
            (new_g * 255.0) as u8,
            (new_b * 255.0) as u8,
            a,
        ];
    }
}

fn composite_images(base: &mut RgbaImage, accessory: &RgbaImage) {
    let (base_w, base_h) = base.dimensions();
    let (acc_w, acc_h) = accessory.dimensions();

    for y in 0..base_h.min(acc_h) {
        for x in 0..base_w.min(acc_w) {
            let base_pixel = base.get_pixel_mut(x, y);
            let acc_pixel = accessory.get_pixel(x, y);

            if acc_pixel.0[3] > 0 {
                let alpha = acc_pixel.0[3] as f32 / 255.0;
                let inv_alpha = 1.0 - alpha;

                base_pixel.0[0] =
                    ((base_pixel.0[0] as f32 * inv_alpha) + (acc_pixel.0[0] as f32 * alpha)) as u8;
                base_pixel.0[1] =
                    ((base_pixel.0[1] as f32 * inv_alpha) + (acc_pixel.0[1] as f32 * alpha)) as u8;
                base_pixel.0[2] =
                    ((base_pixel.0[2] as f32 * inv_alpha) + (acc_pixel.0[2] as f32 * alpha)) as u8;
                base_pixel.0[3] = base_pixel.0[3].max(acc_pixel.0[3]);
            }
        }
    }
}

pub fn encode_to_webp_deterministic(img: &RgbaImage) -> Result<Vec<u8>, JsValue> {
    let (w, h) = img.dimensions();
    let mut out = Vec::new();

    let mut enc = WebPEncoder::new(&mut out);
    let mut params = EncoderParams::default();
    params.use_predictor_transform = true;
    enc.set_params(params);

    enc.encode(img.as_raw(), w, h, ColorType::Rgba8)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(out)
}

fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g.max(b));
    let min = r.min(g.min(b));
    let diff = max - min;
    let l = (max + min) / 2.0;

    if diff == 0.0 {
        return (0.0, 0.0, l);
    }

    let s = if l > 0.5 {
        diff / (2.0 - max - min)
    } else {
        diff / (max + min)
    };
    let h = if max == r {
        60.0 * (((g - b) / diff) % 6.0)
    } else if max == g {
        60.0 * (((b - r) / diff) + 2.0)
    } else {
        60.0 * (((r - g) / diff) + 4.0)
    };

    let h = if h < 0.0 { h + 360.0 } else { h };
    (h, s, l)
}

fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s == 0.0 {
        return (l, l, l);
    }

    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = l - c / 2.0;

    let (r_prime, g_prime, b_prime) = if h < 60.0 {
        (c, x, 0.0)
    } else if h < 120.0 {
        (x, c, 0.0)
    } else if h < 180.0 {
        (0.0, c, x)
    } else if h < 240.0 {
        (0.0, x, c)
    } else if h < 300.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };

    (r_prime + m, g_prime + m, b_prime + m)
}

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
