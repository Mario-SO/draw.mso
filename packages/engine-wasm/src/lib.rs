use draw_diagram_core::Engine as CoreEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Engine {
    inner: CoreEngine,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(json: &str) -> Result<Engine, JsValue> {
        CoreEngine::new(json)
            .map(|inner| Self { inner })
            .map_err(js_error)
    }
    pub fn document(&self) -> String {
        self.inner.document_json()
    }
    pub fn replace(&mut self, json: &str) -> Result<(), JsValue> {
        self.inner.replace(json).map_err(js_error)
    }
    #[wasm_bindgen(js_name = applyPatch)]
    pub fn apply_patch(&mut self, json: &str) -> Result<(), JsValue> {
        self.inner.apply_patch_json(json).map_err(js_error)
    }
    pub fn can_undo(&self) -> bool {
        self.inner.can_undo()
    }
    pub fn can_redo(&self) -> bool {
        self.inner.can_redo()
    }
    pub fn undo(&mut self) -> bool {
        self.inner.undo()
    }
    pub fn redo(&mut self) -> bool {
        self.inner.redo()
    }
    pub fn scene(&self) -> String {
        self.inner.scene_json()
    }
    #[wasm_bindgen(js_name = displayScene)]
    pub fn display_scene(&self) -> String {
        self.inner.display_scene_json()
    }
    #[wasm_bindgen(js_name = previewPatch)]
    pub fn preview_patch(&self, json: &str) -> Result<String, JsValue> {
        self.inner.preview_patch_json(json).map_err(js_error)
    }
    pub fn export_text(&self, ascii: bool) -> Result<String, JsValue> {
        self.inner.export_text(ascii).map_err(js_error)
    }
    pub fn export_svg(&self) -> Result<String, JsValue> {
        self.inner.export_svg().map_err(js_error)
    }
}

fn js_error(error: draw_diagram_core::DiagramError) -> JsValue {
    let js_error = js_sys::Error::new(&error.to_string());
    let _ = js_sys::Reflect::set(
        js_error.as_ref(),
        &JsValue::from_str("code"),
        &JsValue::from_str(error.code().as_str()),
    );
    let _ = js_sys::Reflect::set(
        js_error.as_ref(),
        &JsValue::from_str("details"),
        &JsValue::from_str(&error.json()),
    );
    js_error.into()
}
