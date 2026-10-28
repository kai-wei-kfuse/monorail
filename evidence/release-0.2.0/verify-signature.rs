use minisign_verify::{PublicKey, Signature};
use std::{env, error::Error, fs};

// Inputs are the downloaded installer and the base64-decoded Tauri public key/signature.
// Use the application's existing minisign-verify dependency; never read a signing key.
fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 {
        return Err("usage: verify-signature <installer> <public-key.txt> <signature.txt>".into());
    }
    let key = PublicKey::decode(&fs::read_to_string(&args[2])?)?;
    let signature = Signature::decode(&fs::read_to_string(&args[3])?)?;
    let installer = fs::read(&args[1])?;
    key.verify(&installer, &signature, false)?;
    println!("PASS: installer signature and trusted comment verified against the application public key");
    let mut changed = installer;
    changed[0] ^= 1;
    if key.verify(&changed, &signature, false).is_ok() {
        return Err("tampered installer unexpectedly passed verification".into());
    }
    println!("PASS: one-byte-tampered installer rejected");
    Ok(())
}
