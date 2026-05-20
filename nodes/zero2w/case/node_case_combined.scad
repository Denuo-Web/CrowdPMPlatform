// Combined print plate for the CrowdPM node case.
// This uses the parametric source modules directly instead of modifying
// imported STL meshes, which avoids slicer artifacts from STL booleans.

use <node_case.scad>

base_x = 86.55;
base_y = 80.20;
part_gap = 10.00;

floor_thickness = 2.00;
slot_length = 46.00;
slot_width = 4.00;
slot_y_positions = [22.00, 58.00];
eps = 0.02;
$fn = 48;

module combined_rounded_slot_2d(length, width) {
    hull() {
        translate([width / 2, width / 2]) circle(d = width);
        translate([length - width / 2, width / 2]) circle(d = width);
    }
}

module bottom_slot_cutouts() {
    for (slot_y = slot_y_positions) {
        translate([
            base_x / 2 - slot_length / 2,
            slot_y - slot_width / 2,
            -eps
        ])
            linear_extrude(height = floor_thickness + 2 * eps)
                combined_rounded_slot_2d(slot_length, slot_width);
    }
}

module combined_base_with_bottom_slots() {
    difference() {
        base();
        bottom_slot_cutouts();
    }
}

combined_base_with_bottom_slots();

translate([0, base_y + part_gap, 0])
    lid();
