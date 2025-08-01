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
use image::{imageops, RgbaImage};

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
        let mut accessory_img = image::load_from_memory(accessory_data)
            .map_err(|e| JsValue::from_str(&format!("Failed to load accessory: {}", e)))?
            .to_rgba8();

        accessory_img = imageops::resize(
            &accessory_img,
            base_img.width(),
            base_img.height(),
            imageops::FilterType::Lanczos3,
        );

        composite_images(&mut base_img, &accessory_img);
    }

    let webp_data = encode_to_webp_deterministic(&base_img)?;

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

        let new_s = s.max(0.40);

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
    params.use_predictor_transform = false;
    enc.set_params(params);

    if img.pixels().all(|p| p.0[3] == 255) {
        let mut rgb_buf = Vec::with_capacity((w * h * 3) as usize);
        for px in img.pixels() {
            rgb_buf.extend_from_slice(&px.0[..3]);
        }
        enc.encode(&rgb_buf, w, h, ColorType::Rgb8)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
    } else {
        enc.encode(img.as_raw(), w, h, ColorType::Rgba8)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{rngs::SmallRng, RngCore, SeedableRng};
    use wasm_bindgen_test::*;

    fn decode_hex(s: &str) -> Vec<u8> {
        hex::decode(s).expect("Failed to decode hex string")
    }

    #[wasm_bindgen_test]
    fn generated_images_are_always_under_4096_with_real_data() {
        let base_images = vec![
            decode_hex("524946465607000057454250565038580a000000200000002c00003a000049434350c8010000000001c800000000043000006d6e74725247422058595a2007e00001000100000000000061637370000000000000000000000000000000000000000000000000000000010000f6d6000100000000d32d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000964657363000000f0000000247258595a00000114000000146758595a00000128000000146258595a0000013c00000014777470740000015000000014725452430000016400000028675452430000016400000028625452430000016400000028637072740000018c0000003c6d6c756300000000000000010000000c656e5553000000080000001c007300520047004258595a200000000000006fa2000038f50000039058595a2000000000000062990000b785000018da58595a2000000000000024a000000f840000b6cf58595a20000000000000f6d6000100000000d32d706172610000000000040000000266660000f2a700000d59000013d000000a5b00000000000000006d6c756300000000000000010000000c656e5553000000200000001c0047006f006f0067006c006500200049006e0063002e002000320030003100365650382068050000901c009d012a2d003b003e311888432221a1140d55c4200304b48009c61f877fb01eb3f864eff7ab3fb73fd579e77337f72fc33f0b3f3efc57fe1ffe87fc5f3b3dc03d52ff38fc47fdcbff2dc7b58bffa7fe52ff74fdaae903d903dc7ffabfe587be3fd43fa6f8b0fc9fd057f9bff5dfc89feabf0d5fb17e26ff70ffbbf06fe64ff29f90bfd27ec27f97ff2bfec7fd7ff6b3fa6ffe1fa55f5c9fae9ec29fa70c79214e4fea972b75b2c6d174f6e7ce797fdcbfdad035df3575f97570c8ee8df3cec86df20ecfb2990abc150cafc750b76e3393b6c5ce318be11b62f48b813ed01be4a7ae69d20aa56b51e1a8c000fefffe945c7c2ee7529ed74bb287057c52cfa87d4cca8037e6abfee1e81c3ffa06d386a1fcba55ea0adc46bb0b422730c7fd7f753c30d4c1fc2452cca3e87bd3a5e0db73528ee781110ede637637c6f77c6efb0f0ffffbf198c620459d96f643f0742ffecb9f0e9b8474fb3fad96b183f43b6fc83ff87b343c66ed84f47f8f7829d51dbb7e23be26465e43836d025e2a901ceebe76c0473a5ee799177791f9505b49383e20754dafe96d4f15ff7d6f61e8a9122ae7bed3d562b46911ddb69d275a06b7f191aeb4989d9f87ad1fdb76d1ca66c25fd068634cc29a52929231c1737715cfda4a0e052167481335d81eecd5d119ed6dc00f9483defa505e90d3e4c3eced58c855fd97f727b1190e1ded4d44acdbca707c5122ec1d16d96d9711b9454a0dbbae1552aa5e8ff3c7fc5d8e59972290664f804636fc61c8dd4a3b54ac91806bc655be63226a854d40d1aaa5e01f20e4efe1fff57eb1797c4280204974fba1baa21054d816248365e7fe195db3b757dd620dc8215b23365908787fff2c1de3d5f32915907ce9ffc54364203463e2c7a3077739ccac427e5116ff19d569243702abc0250c21675f93d2135a0afc239a0b9082f2c421f2e60eab9ceb1d2a0e59c77b15a3f4d236d8a394f2fc1c269762bf00a5b3b02d7a243493074954b7a27cdf0eeebb26a2d2cde957ffe3f5487ba6a9a1218fffc210091ea190bab16a4ea397508c84d770cd7d4136fc4d0898f6373820b3a84aae43993cf477dae1de0685a85e5754161664eaa601bec9882980d26056c5f90b6b6c3952855a74dd4e9511b4c2dc797d254437224d9eaeddb4ad75bdc6c452eac2f8da56a95b961233c0c59f01317a9dc9956f50f04f330a908a81f8ef51339bd41ca884e6284fd78727b98755e762fcd17f34c4b65b63d17f63724379113a87ffcd13f08cebd14a285fda254808bd77c7fbad5d21a6db0453b1bf4740ff1bdb88606caf65ff0f2b3d473fb75ce6e1fd8751cfa65b132963287f3ccbf581382f0d457c649ba96038a934ca7f1aed1bea34203a572a3e6be667a0ba7644acca8d9e7bdd4645d497460acad21e72de589c776c3f02db8a9d9bcb327e5652cb05ee96e8b8adc5025137c692b8eb5e96bfc1d81e3ba983a6b0d5a0ad60d09b88126f349563928dac5ca845a2d6b3e9e641693775a0590c9a7903d9985fd3afc189c1c4257add39e34d58df5cc8a2e41f488f8809dee0d9d809a21c5d78dfb3edb75ef95a2b56c03faf8442dc38a19bfff6a20152e1785c2bc67f46f00ced2bffd94b76244982e5138a71ae23a88aa3fe6403d551d2a6567363727152cf72c72d19794fa8e86a86e39b3749292169fe8424fdd9556e62e94fd3ede44698caf7695a4e508ab5d9c6df6f6d763b4dd9117a84924158f942c355ffc4628bf3849139fb0fffc794f4c8e3ae3ff3bbf2ac42f873445d0e838c957016afacff41c2e74098b33873a0899e06c22590135e4f38e9a59ed17fff6c65b94ca178d04ad3ceccebeb8537f19a41f20476573cd0075df403b7b2280caf07a880afb611b8534499d0482850113df153e4a299df0ada3a9b6e64f92be8eb1b17e5e49ba9c1220e03bf3a91c00000"), // angry
        ];

        let accessories = vec![
            decode_hex("524946466e04000057454250565038580a000000300000002c00003a000049434350c8010000000001c800000000043000006d6e74725247422058595a2007e00001000100000000000061637370000000000000000000000000000000000000000000000000000000010000f6d6000100000000d32d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000964657363000000f0000000247258595a00000114000000146758595a00000128000000146258595a0000013c00000014777470740000015000000014725452430000016400000028675452430000016400000028625452430000016400000028637072740000018c0000003c6d6c756300000000000000010000000c656e5553000000080000001c007300520047004258595a200000000000006fa2000038f50000039058595a2000000000000062990000b785000018da58595a2000000000000024a000000f840000b6cf58595a20000000000000f6d6000100000000d32d706172610000000000040000000266660000f2a700000d59000013d000000a5b00000000000000006d6c756300000000000000010000000c656e5553000000200000001c0047006f006f0067006c006500200049006e0063002e00200032003000310036414c50484a000000010f30ff1111c26d6cdb4ab5f19012e88294d628cd1aa1027777fd1247f47f02f8d1b6b0236d1cc9040221dc199bc9cfe8a7699a88a769b2707698a6c9b84d8771a7b6260d6cade7af04565038202e020000f00e009d012a2d003b003e31168842a22121180c04ac200304b100698b5262406d80f301fa8dfaddd803d003f667ac03d003f557d277f677e067f70bd803f5daeee6a015b13d46bf55ff81e513e5eff41ee07fa85fe63ac07a007eb3226285bfaa75080afaabfc896ba0d910168a977ba95e7f6166f75e23e3eeed753782400000feff0d6617f271ad56f0d475130c7392e57b0c62bb3c30879b682476eaf9e43cf31ede60e0bd5671f366712265c5ce08dd6b1e642ffe867e452aaa240ef7b2a2c56bcdff7fc6d1b387dc5ab971d5e69a2b93aa8f640c4ef2122cda5e84930bad6d303335f8eef9e6ac449c6fcc565de3133a11ce5536f6ee0637c5c24f31034ef7c837fbf6942a7fe0bef7510a46ab91058a3d9b38d45842a9c58547de31268dc616bcc86992947f6df3752eabbc5eb3073fe5c758f8804e4831651d49b765e1dd1ae31ff478e5528d78d7a6e97f4f105c9dde470c3e846465ae5eec0094eff035f6d727a51b20f1b432742aa6faaa213b75bebdcf62769b4d24017e5dd9d4f88f0827e50b3dbde32dd84adcf1d0304c3fcfee720638527f01d9165c466de91594d3aad09af31438e11d9dd1d6fac37f311d027001a50d6ff00332fcbf4bdc8d17cda4f31d9b2d535a6ce6e3683ac70fff2bff055fa7ca889da3e78b6018cd2550b89c68facadebf3e06b9b480f29b682714e245fdfe82f6e5137abc5cdc586c67847ec009e34ade4653ac5e64b8a53c6629105d018cd876ed5a3a4933f131fc8227c4023da85e684c67800000"), // pinkGlasses
        ];

        let base_js = serde_wasm_bindgen::to_value(&base_images).unwrap();
        let acc_js = serde_wasm_bindgen::to_value(&accessories).unwrap();

        let mut rng = SmallRng::seed_from_u64(0);

        // Loop 1000 times to test many random combinations
        for i in 0..1000000 {
            let pubkey_hex = loop {
                let mut bytes = [0u8; 32];
                rng.fill_bytes(&mut bytes);
                if XOnlyPublicKey::from_slice(&bytes).is_ok() {
                    break hex::encode(bytes);
                }
            };

            // The assertion provides a more helpful error message on failure
            let result = generate_labitbu_bytes(&pubkey_hex, base_js.clone(), acc_js.clone());
            assert!(
                result.is_ok(),
                "Image exceeded 4096-byte cap on iteration {} with pubkey {}",
                i,
                pubkey_hex
            );
        }
    }
}
