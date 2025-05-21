// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{DynamicImage, GenericImageView, ImageFormat};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;
use tauri_plugin_fs;

#[derive(Debug, Serialize, Deserialize)]
pub struct CompressionResult {
    compressed_data: String,
    original_size: usize,
    compressed_size: usize,
    format: String,
}

fn get_image_format(file_name: &str) -> ImageFormat {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "jpg" | "jpeg" => ImageFormat::Jpeg,
        "png" => ImageFormat::Png,
        "gif" => ImageFormat::Gif,
        "bmp" => ImageFormat::Bmp,
        "tiff" | "tif" => ImageFormat::Tiff,
        "ico" => ImageFormat::Ico,
        "webp" => ImageFormat::WebP,
        "avif" => ImageFormat::Avif,
        _ => ImageFormat::Png, // Default to PNG
    }
}

fn optimize_image(img: DynamicImage) -> DynamicImage {
    // If the image is too large, resize it while maintaining aspect ratio
    let (width, height) = img.dimensions();
    let max_dimension = 1920; // Max width or height

    if width > max_dimension || height > max_dimension {
        let ratio = width as f32 / height as f32;
        let new_width = if width > height {
            max_dimension
        } else {
            (max_dimension as f32 * ratio) as u32
        };
        let new_height = if width > height {
            (max_dimension as f32 / ratio) as u32
        } else {
            max_dimension
        };

        return img.resize(new_width, new_height, image::imageops::FilterType::Lanczos3);
    }

    img
}

fn compress_jpeg(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    let rgb = img.to_rgb8();
    let (width, height) = rgb.dimensions();
    let mut dest = Vec::new();
    let mut comp = mozjpeg::Compress::new(mozjpeg::ColorSpace::JCS_RGB);
    comp.set_size(width as usize, height as usize);
    comp.set_quality(quality as f32);
    comp.set_optimize_coding(true);
    let mut comp = comp.start_compress(&mut dest).map_err(|e| e.to_string())?;
    for row in rgb.rows() {
        let row_bytes: Vec<u8> = row.flat_map(|p| p.0).collect();
        comp.write_scanlines(&row_bytes)
            .map_err(|e| e.to_string())?;
    }
    comp.finish().map_err(|e| e.to_string())?;
    Ok(dest)
}

fn compress_png(img: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut compressed_data = Vec::new();
    // Use the image crate for now, oxipng expects a PNG file, not raw RGBA
    img.write_to(&mut Cursor::new(&mut compressed_data), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(compressed_data)
}

fn compress_webp(img: &DynamicImage, quality: f32) -> Result<Vec<u8>, String> {
    let encoder = webp::Encoder::from_image(img).map_err(|e| e.to_string())?;
    let encoded = encoder.encode(quality);
    Ok(encoded.to_vec())
}

fn compress_avif(img: &DynamicImage, quality: f32) -> Result<Vec<u8>, String> {
    use ravif::{Img, RGBA8};
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let imgref = Img::new(
        // flatten to &[RGBA8]
        unsafe {
            std::slice::from_raw_parts(rgba.as_ptr() as *const RGBA8, (width * height) as usize)
        },
        width as usize,
        height as usize,
    );
    let enc = ravif::Encoder::new().with_quality(quality).with_speed(4);
    let result = enc.encode_rgba(imgref).map_err(|e| e.to_string())?;
    Ok(result.avif_file)
}

#[tauri::command]
async fn compress_image(
    image_data: String,
    file_name: String,
) -> Result<CompressionResult, String> {
    // Remove the data URL prefix if present
    let base64_data = if image_data.starts_with("data:") {
        image_data.split(',').nth(1).ok_or("Invalid image data")?
    } else {
        &image_data
    };

    // Decode base64 to bytes
    let image_bytes = BASE64
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Load the image
    let img = image::load_from_memory(&image_bytes)
        .map_err(|e| format!("Failed to load image: {}", e))?;

    // Optimize the image
    let optimized_img = optimize_image(img);

    // Get the format and compress accordingly
    let format = get_image_format(&file_name);
    let compressed_data = match format {
        ImageFormat::Jpeg => compress_jpeg(&optimized_img, 85)?,
        ImageFormat::Png => compress_png(&optimized_img)?,
        ImageFormat::WebP => compress_webp(&optimized_img, 85.0)?,
        ImageFormat::Avif => compress_avif(&optimized_img, 85.0)?,
        _ => {
            // For other formats, use the image crate's default compression
            let mut data = Vec::new();
            optimized_img
                .write_to(&mut Cursor::new(&mut data), format)
                .map_err(|e| format!("Failed to compress image: {}", e))?;
            data
        }
    };

    // Convert compressed data back to base64
    let compressed_base64 = BASE64.encode(&compressed_data);

    Ok(CompressionResult {
        compressed_data: compressed_base64,
        original_size: image_bytes.len(),
        compressed_size: compressed_data.len(),
        format: format!("{:?}", format),
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![compress_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
