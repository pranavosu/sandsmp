pub mod cell;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn greet() -> String {
    "Hello from simulation!".into()
}
