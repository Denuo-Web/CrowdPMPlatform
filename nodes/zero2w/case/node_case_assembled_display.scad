// Presentation-only assembled CrowdPM node case.
//
// The production STL files are print-oriented: the base and lid are separate,
// and the lid's outside top face is down on the print bed. This wrapper imports
// those STLs, flips the lid into its installed orientation, and adds dark-blue
// lid markings for product renders. It is not intended to replace the
// print-ready base/lid STL files.

$fn = 96;

outer_x = 86.55;
outer_y = 80.20;
base_h = 33.75;
lid_thickness = 2.00;
assembled_h = base_h + lid_thickness;
eps = 0.02;

case_white = "#f7f8f2";
lid_blue = "#102f68";
label_font = "Liberation Sans:style=Bold";

gps_center_x = outer_x - 21.5;
gps_center_y = outer_y / 2 + 8.475;
gps_opening = 10 / 16 * 25.4;

module label_2d(value, size) {
    text(value, size = size, font = label_font, halign = "center", valign = "center");
}

module display_label(value, x, y, size) {
    translate([x, y, assembled_h + eps])
        color(lid_blue)
            linear_extrude(height = 0.18)
                label_2d(value, size);
}

module display_qr_marker() {
    // Simplified render marker: enough visual detail for product artwork without
    // making the presentation model depend on the full QR matrix.
    module finder(x, y) {
        translate([x, y, assembled_h + eps])
            color(lid_blue)
                linear_extrude(height = 0.18)
                    difference() {
                        square([4.2, 4.2]);
                        translate([0.85, 0.85]) square([2.5, 2.5]);
                    }
        translate([x + 1.55, y + 1.55, assembled_h + eps])
            color(lid_blue)
                linear_extrude(height = 0.18)
                    square([1.1, 1.1]);
    }

    qr_x = gps_center_x - 10.0;
    qr_y = 2.8;
    finder(qr_x, qr_y);
    finder(qr_x + 12.0, qr_y);
    finder(qr_x, qr_y + 12.0);

    for (i = [0 : 5]) {
        translate([qr_x + 6.0 + i * 1.7, qr_y + 6.0 + (i % 3) * 1.7, assembled_h + eps])
            color(lid_blue)
                linear_extrude(height = 0.18)
                    square([0.95, 0.95]);
    }
}

module display_markings() {
    display_label("Crowd PM Node", outer_x / 2, outer_y - 6.8, 5.6);
    display_label("crowdpmplatform.web.app", outer_x / 2, outer_y - 14.0, 3.0);
    display_label("GPS", gps_center_x, gps_center_y + gps_opening / 2 + 4.7, 3.6);
    display_label("This side", gps_center_x, gps_center_y - gps_opening / 2 - 2.6, 2.4);
    display_label("towards sky.", gps_center_x, gps_center_y - gps_opening / 2 - 5.8, 2.4);
    display_qr_marker();
}

module installed_lid() {
    // The lid STL is print-oriented with its outside face at Z=0 and the lip
    // pointing upward. Mirroring across Z turns the lip downward into the base,
    // then translating by assembled_h puts the outside face on top.
    translate([0, 0, assembled_h])
        mirror([0, 0, 1])
            import("node_case_lid.stl", convexity = 10);
}

module node_case_assembled_display() {
    color(case_white)
        import("node_case_base.stl", convexity = 10);

    color(case_white)
        installed_lid();

    display_markings();
}

node_case_assembled_display();
