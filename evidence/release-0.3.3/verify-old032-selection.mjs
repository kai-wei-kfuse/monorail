// Compile the tagged, unmodified pure Rust selection/compatibility functions against live Release data.
// 0.3.3 stable: adapted from the 0.3.0 publication check.
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const dir = resolve('evidence/release-0.3.3');
const temp = await mkdtemp(join(tmpdir(), 'monorail-033-channel-selection-'));
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const releases = gh(['api', '--paginate', '--slurp', 'repos/kai-wei-kfuse/monorail/releases?per_page=100']);
await writeFile(join(dir, 'channel-release-list.json'), releases);
const source = file => execFileSync('git', ['show', `v0.3.2:${file}`], { encoding: 'utf8' });
const channel = source('src-tauri/src/update_channel.rs').split('#[derive(Serialize, Deserialize)]')[0];
const state = source('src-tauri/src/update_state.rs');
const compatibility = state.slice(state.indexOf('#[derive'), state.indexOf('#[derive', state.indexOf('#[derive') + 1));
const pure = source('src-tauri/src/private_release.rs').split('fn github(')[0]
  .replace('use tauri_plugin_updater::UpdaterExt;', '')
  .replace('use super::update_state::{Candidate, CompatibilityInfo, ReleaseInfo, Step, TargetPermit};', 'use super::update_state::CompatibilityInfo;');
const main = `
use std::{env,fs};
mod update_channel { ${channel} }
mod update_state { use serde::{Serialize,Deserialize}; ${compatibility} }
mod private_release { ${pure} }
use update_channel::{Channel,UpdateIntent};
fn main() {
 let args:Vec<_>=env::args().collect();
 let records=private_release::parse_release_list(&fs::read(&args[1]).unwrap()).unwrap();
 let (stable,sv)=private_release::select_release_candidate(&records,Channel::Stable,UpdateIntent::Upgrade).unwrap();
 let (beta,bv)=private_release::select_release_candidate(&records,Channel::Beta,UpdateIntent::Upgrade).unwrap();
 let (back,_)=private_release::select_release_candidate(&records,Channel::Beta,UpdateIntent::ReturnToStable).unwrap();
 assert_eq!(stable.tag_name,"v0.3.3");
 assert_eq!(beta.tag_name,"v0.3.3");
 assert_eq!(back.tag_name,"v0.3.3");
 assert!(private_release::should_accept_remote_version("0.3.0","0.3.3","0.3.3",Channel::Stable,UpdateIntent::Upgrade,true));
 let current=private_release::parse_product_version("0.3.2").unwrap();
 assert!(private_release::should_accept_remote_version("0.3.2","0.3.3","0.3.3",Channel::Stable,UpdateIntent::Upgrade,true));
 assert!(sv>current); assert!(bv>current);
 let (_,compat)=private_release::validate_manifest_and_compatibility_with_base(&fs::read(&args[2]).unwrap(),&sv,false,"kai-wei-kfuse/monorail",&current,None).unwrap();
 assert!(compat.compatible); assert_eq!(compat.source,"manifest");
 assert!(private_release::should_accept_remote_version("0.2.5","0.3.3","0.3.3",Channel::Stable,UpdateIntent::Upgrade,true));
 assert!(private_release::should_accept_remote_version("0.3.1","0.3.3","0.3.3",Channel::Stable,UpdateIntent::Upgrade,true));
 assert!(private_release::should_accept_remote_version("0.3.0-beta.3","0.3.3","0.3.3",Channel::Beta,UpdateIntent::Upgrade,true));
 assert!(private_release::should_accept_remote_version("0.3.0-beta.3","0.3.3","0.3.3",Channel::Stable,UpdateIntent::Upgrade,true));
 assert!(private_release::should_accept_remote_version("0.3.0-beta.3","0.3.3","0.3.3",Channel::Stable,UpdateIntent::ReturnToStable,true));
 assert!(!private_release::should_accept_remote_version("0.3.3","0.3.3","0.3.3",Channel::Stable,UpdateIntent::Upgrade,true));
 println!("PASS: live stable, beta and return-to-stable all select v0.3.3; old 0.3.2 selector accepts manifest schema 3 via readable [2,3]; upgrades from 0.2.5, 0.3.0, 0.3.1 and 0.3.0-beta.3 accepted; 0.3.3 does not re-offer itself");
}`;
const file = join(temp, 'verify.rs');
await writeFile(file, main);
// Cargo resolves one coherent feature graph; arbitrary cached rlib selection can mix serde builds.
await writeFile(join(temp, 'Cargo.toml'), `[package]
name = "channel-release-check"
version = "0.1.0"
edition = "2021"
[[bin]]
name = "channel-release-check"
path = "verify.rs"
[dependencies]
http = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
url = { version = "2", features = ["serde"] }
`);
execFileSync('cargo', ['build', '--offline', '--manifest-path', join(temp, 'Cargo.toml')], { stdio: 'pipe', timeout: 120000 });
const output = execFileSync(join(temp, 'target/debug/channel-release-check.exe'), [join(dir, 'channel-release-list.json'), join(dir, 'published/latest.json')], { encoding: 'utf8', timeout: 60000 });
await writeFile(join(dir, 'old032-channel-selection.log'), output);
console.log(output.trim());
