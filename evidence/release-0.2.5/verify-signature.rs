use minisign_verify::{PublicKey, Signature};
use std::{env, fs};

fn main() {
    let args: Vec<_> = env::args().collect();
    assert_eq!(args.len(), 4, "Expected installer, decoded public key, decoded signature");
    let mut installer = fs::read(&args[1]).expect("read installer");
    let key = PublicKey::decode(&fs::read_to_string(&args[2]).expect("read public key")).expect("decode public key");
    let signature = Signature::decode(&fs::read_to_string(&args[3]).expect("read signature")).expect("decode signature");
    key.verify(&installer, &signature, false).expect("verify installer signature and trusted comment");
    println!("PASS: installer signature and trusted comment match the application public key");
    installer[0] ^= 1;
    assert!(key.verify(&installer, &signature, false).is_err(), "tampered installer must be rejected");
    println!("PASS: one-byte-tampered installer rejected");
}
