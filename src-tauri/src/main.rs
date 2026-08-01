#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let arguments = std::env::args().collect::<Vec<_>>();
    if arguments.len() == 3 && arguments[1] == "--file-to-vox-worker" {
        std::process::exit(voxel_gallery_lib::run_file_to_vox_worker(&arguments[2]));
    }
    voxel_gallery_lib::run();
}
