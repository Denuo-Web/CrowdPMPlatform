// CrowdPM node case.
// Two-piece 3D-printable enclosure for a node with a clear inside cavity of
// 3.25 in x 3.00 in x 1.25 in.
//
// Units are millimeters. Export with:
//   openscad -o node_case_base.stl -D 'part="base"' node_case.scad
//   openscad -o node_case_lid.stl  -D 'part="lid"'  node_case.scad

part = "assembly"; // "base", "lid", or "assembly"

inch = 25.4;
eps = 0.02;
$fn = 48;

// Required clear cavity.
inner_x = 3.25 * inch;
inner_y = 3.00 * inch;
inner_z = 1.25 * inch;

// Case fit and print defaults.
wall = 2.0;
floor_thickness = 2.0;
lid_thickness = 2.0;
lid_fit_clearance = 0.50;
lid_lip_depth = 5.0;
lid_lip_wall = 1.2;
rim_chamfer = 0.60;
lip_chamfer = 0.60;
port_chamfer = 0.80;

outer_x = inner_x + 2 * wall;
outer_y = inner_y + 2 * wall;
base_h = floor_thickness + inner_z;
assembled_h = base_h + lid_thickness;
lip_outer_x = inner_x - 2 * lid_fit_clearance;
lip_outer_y = inner_y - 2 * lid_fit_clearance;

// Serviceable snap detents: rounded lid beads engage matching base grooves.
snap_detent_radius = 0.70;
snap_groove_clearance = 0.18;
snap_detent_length = 14.0;
snap_detent_depth = 2.7;
snap_detent_y_positions = [outer_y * 0.32, outer_y * 0.68];
pry_notch_width = 19.0;
pry_notch_height = 5.0;

// USB and reset features on B / -X.
usb_width = 14.5;
usb_height = 8.0;
usb_roof_height = usb_width / 2;
reset_diameter = 5.5;
port_center_z = floor_thickness + 11.5;
reset_center_y = outer_y / 2 - 12.0;
usb_reset_gap = 6.0;
usb_center_y = reset_center_y - reset_diameter / 2 - usb_reset_gap - usb_width / 2;

// C / +Y side vents.
side_slot_count = 4;
side_slot_height = 20.0;
side_slot_width = 4.0;
side_slot_pitch = 7.2;
side_slot_x = wall;

// Lid top vents, shifted toward -X to avoid the GPS antenna opening.
top_slot_count = 6;
top_slot_length = 42.0;
top_slot_width = 4.0;
top_slot_pitch = 8.5;
top_slot_center_x = outer_x / 2 - 13.0;

// Raspberry Pi Zero 2 W reference.
pi_board_x = 65.0;
pi_board_y = 30.0;
pi_hole_inset = 3.5;
pi_standoff_h = 0.25 * inch;
pi_standoff_d = 6.5;
pi_pilot_d = 2.2;
pi_a_face_clearance = 0.5;
pi_d_face_clearance = 0.5;

// GPS lid reference.
gps_opening = 10 / 16 * inch;
gps_antenna = 15.0;
gps_board_x = 25.5;
gps_board_y = 35.0;
gps_boss_d = 6.0;
gps_boss_h = 4.0;
gps_pcb_mount_hole_d = 2.5;
gps_pilot_d = 2.2; // Screw pilot; GPS PCB plated mounting holes are 2.5 mm.
gps_center_x = outer_x - 21.5;
gps_center_y = outer_y / 2 + 8.475;
// Adafruit Ultimate GPS Eagle board coordinates, relative to U1 antenna/module center.
gps_hole_left_dx = 2.54 - 12.192;
gps_hole_right_dx = 22.86 - 12.192;
gps_hole_dy = 31.75 - 17.526;

// Text engraving font.
label_font = "Liberation Sans:style=Bold";

// Outside E-face etching. The lid STL is lip-up, so the outside face is Z=0.
etch_depth = 0.75;
title_text = "Crowd PM Node";
gps_label_text = "GPS";
gps_sky_text_1 = "This side";
gps_sky_text_2 = "towards sky.";
site_text = "crowdpmplatform.web.app";
site_qr_payload = "https://crowdpmplatform.web.app";
qr_version = 2; // Low error correction, shortest payload above.
qr_matrix_size = 25;
qr_module = 0.95;
qr_quiet_modules = 4;
qr_overlap = 0.02;
qr_x = gps_center_x - (qr_matrix_size + 2 * qr_quiet_modules) * qr_module / 2;
qr_y = 0.60;
qr_matrix = [
    [1,1,1,1,1,1,1,0,1,1,0,0,0,1,1,0,0,0,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,0,1,1,0,0,0,1,0,0,0,0,0,1],
    [1,0,1,1,1,0,1,0,0,1,1,0,1,1,1,1,0,0,1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1,0,0,1,0,0,1,1,0,1,1,0,1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1,0,0,1,1,0,0,0,0,0,1,0,1,0,1,1,1,0,1],
    [1,0,0,0,0,0,1,0,0,0,1,1,1,0,1,0,1,0,1,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],
    [0,0,0,0,0,0,0,0,1,0,0,1,0,1,1,0,0,0,0,0,0,0,0,0,0],
    [1,1,0,1,1,0,1,0,0,1,1,1,1,0,1,1,0,0,1,0,0,0,0,0,1],
    [1,1,1,1,0,0,0,0,1,1,1,1,1,0,1,1,0,1,0,1,1,1,1,1,0],
    [1,1,1,0,0,0,1,0,1,0,1,1,1,1,0,1,1,1,1,1,0,1,0,0,1],
    [1,1,0,0,0,0,0,0,0,1,1,0,1,0,0,0,0,1,0,0,0,1,1,1,1],
    [0,0,1,0,0,1,1,1,1,1,0,1,1,0,0,0,1,0,1,1,0,0,0,0,1],
    [1,1,1,0,0,1,0,1,1,1,0,1,0,0,1,1,1,0,0,0,1,0,0,1,0],
    [1,1,0,0,0,0,1,1,0,1,0,0,0,0,1,1,1,1,0,0,1,1,1,1,1],
    [1,0,1,1,1,1,0,1,0,1,1,0,0,0,0,0,1,1,0,1,0,1,1,0,1],
    [1,0,1,0,0,1,1,1,0,0,0,1,1,1,0,1,1,1,1,1,1,0,1,1,0],
    [0,0,0,0,0,0,0,0,1,1,0,0,0,0,1,1,1,0,0,0,1,0,1,1,0],
    [1,1,1,1,1,1,1,0,0,0,1,1,0,0,1,0,1,0,1,0,1,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,1,1,0,1,1,1,1,0,0,0,1,0,0,1,0],
    [1,0,1,1,1,0,1,0,1,0,1,0,0,0,1,1,1,1,1,1,1,0,0,1,0],
    [1,0,1,1,1,0,1,0,1,1,0,1,0,1,1,0,1,1,1,0,0,0,0,1,1],
    [1,0,1,1,1,0,1,0,0,1,1,1,1,0,0,0,0,0,0,0,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,1,1,1,0,0,0,1,0,0,0,1,1,1,0,1,1,1],
    [1,1,1,1,1,1,1,0,1,0,0,0,1,0,1,0,1,0,0,0,0,1,0,0,1],
];

module rounded_rect(size, radius) {
    hull() {
        translate([radius, radius]) circle(r = radius);
        translate([size[0] - radius, radius]) circle(r = radius);
        translate([radius, size[1] - radius]) circle(r = radius);
        translate([size[0] - radius, size[1] - radius]) circle(r = radius);
    }
}

module rounded_slot_2d(length, width) {
    hull() {
        translate([width / 2, width / 2]) circle(d = width);
        translate([length - width / 2, width / 2]) circle(d = width);
    }
}

module label_2d(value, size) {
    text(value, size = size, font = label_font, halign = "center", valign = "center");
}

module top_chamfered_box(size, chamfer) {
    sx = size[0];
    sy = size[1];
    sz = size[2];

    if (chamfer <= 0) {
        cube(size);
    } else {
        hull() {
            cube([sx, sy, sz - chamfer]);

            translate([chamfer, chamfer, sz - eps])
                cube([sx - 2 * chamfer, sy - 2 * chamfer, eps]);
        }
    }
}

module base_inner_rim_chamfer_cutout() {
    hull() {
        translate([wall, wall, base_h - rim_chamfer - eps])
            cube([inner_x, inner_y, eps]);

        translate([wall - rim_chamfer, wall - rim_chamfer, base_h - eps])
            cube([inner_x + 2 * rim_chamfer, inner_y + 2 * rim_chamfer, eps]);
    }
}

module side_vent_cutouts() {
    center_z = floor_thickness + inner_z / 2;

    for (i = [0 : side_slot_count - 1]) {
        translate([
            side_slot_x + i * side_slot_pitch,
            outer_y + eps,
            center_z - side_slot_height / 2
        ])
            rotate([90, 0, 0])
                linear_extrude(height = wall + 2 * eps)
                    rounded_rect([side_slot_width, side_slot_height], side_slot_width / 2);
    }
}

module usb_cutout() {
    union() {
        translate([
            -eps,
            usb_center_y - usb_width / 2,
            port_center_z - usb_height / 2
        ])
            cube([wall + 2 * eps, usb_width, usb_height]);

        translate([0, usb_center_y, port_center_z + usb_height / 2])
            polyhedron(
                points = [
                    [-eps, -usb_width / 2, 0],
                    [-eps, usb_width / 2, 0],
                    [-eps, 0, usb_roof_height],
                    [wall + eps, -usb_width / 2, 0],
                    [wall + eps, usb_width / 2, 0],
                    [wall + eps, 0, usb_roof_height]
                ],
                faces = [
                    [0, 1, 2],
                    [3, 5, 4],
                    [0, 3, 4, 1],
                    [1, 4, 5, 2],
                    [2, 5, 3, 0]
                ]
            );
    }
}

module usb_chamfer_cutout() {
    translate([-eps, usb_center_y, port_center_z])
        hull() {
            translate([
                0,
                -usb_width / 2 - port_chamfer,
                -usb_height / 2 - port_chamfer
            ])
                cube([
                    eps,
                    usb_width + 2 * port_chamfer,
                    usb_height + 2 * port_chamfer
                ]);

            translate([port_chamfer, -usb_width / 2, -usb_height / 2])
                cube([eps, usb_width, usb_height]);
        }
}

module reset_cutout() {
    translate([-eps, reset_center_y, port_center_z])
        rotate([0, 90, 0])
            cylinder(h = wall + 2 * eps, d = reset_diameter);
}

module reset_chamfer_cutout() {
    translate([-eps, reset_center_y, port_center_z])
        rotate([0, 90, 0])
            cylinder(
                h = port_chamfer + eps,
                d1 = reset_diameter + 2 * port_chamfer,
                d2 = reset_diameter
            );
}

module snap_groove_x(x, y) {
    translate([x, y, base_h - snap_detent_depth])
        rotate([90, 0, 0])
            cylinder(
                h = snap_detent_length + 0.8,
                r = snap_detent_radius + snap_groove_clearance,
                center = true
            );
}

module snap_groove_cutouts() {
    for (y = snap_detent_y_positions) {
        snap_groove_x(wall, y);
        snap_groove_x(wall + inner_x, y);
    }
}

module pry_notch_cutout() {
    translate([
        outer_x / 2 - pry_notch_width / 2,
        -eps,
        base_h - pry_notch_height
    ])
        cube([pry_notch_width, wall + 2 * eps, pry_notch_height + eps]);
}

module base_shell() {
    difference() {
        top_chamfered_box([outer_x, outer_y, base_h], rim_chamfer);

        translate([wall, wall, floor_thickness])
            cube([inner_x, inner_y, inner_z + eps]);

        base_inner_rim_chamfer_cutout();
        side_vent_cutouts();
        usb_cutout();
        usb_chamfer_cutout();
        reset_cutout();
        reset_chamfer_cutout();
        snap_groove_cutouts();
        pry_notch_cutout();
    }
}

module pi_standoff(x, y) {
    translate([x, y, floor_thickness - eps])
        difference() {
            cylinder(h = pi_standoff_h + eps, d = pi_standoff_d);

            translate([0, 0, -eps])
                cylinder(h = pi_standoff_h + 2 * eps, d = pi_pilot_d);
        }
}

module pi_standoffs() {
    // Rotate the Pi Zero 2 W hole pattern 90 degrees and tuck it into A / +X and D / -Y.
    mount_x = pi_board_y;
    mount_y = pi_board_x;
    x0 = outer_x - wall - pi_a_face_clearance - mount_x;
    y0 = wall + pi_d_face_clearance;

    for (x = [x0 + pi_hole_inset, x0 + mount_x - pi_hole_inset]) {
        for (y = [y0 + pi_hole_inset, y0 + mount_y - pi_hole_inset]) {
            pi_standoff(x, y);
        }
    }
}

module base() {
    union() {
        base_shell();
        pi_standoffs();
    }
}

module top_vent_cutouts() {
    total_y = (top_slot_count - 1) * top_slot_pitch + top_slot_width;
    start_y = outer_y / 2 - total_y / 2;

    for (i = [0 : top_slot_count - 1]) {
        translate([
            top_slot_center_x - top_slot_length / 2,
            start_y + i * top_slot_pitch,
            -eps
        ])
            linear_extrude(height = lid_thickness + 2 * eps)
                rounded_slot_2d(top_slot_length, top_slot_width);
    }
}

module gps_opening_cutout() {
    translate([
        gps_center_x - gps_opening / 2,
        gps_center_y - gps_opening / 2,
        -eps
    ])
        cube([gps_opening, gps_opening, lid_thickness + 2 * eps]);
}

module lid_lip() {
    translate([wall + lid_fit_clearance, wall + lid_fit_clearance, lid_thickness - eps])
        difference() {
            top_chamfered_box([lip_outer_x, lip_outer_y, lid_lip_depth + eps], lip_chamfer);

            translate([lid_lip_wall, lid_lip_wall, -eps])
                cube([
                    lip_outer_x - 2 * lid_lip_wall,
                    lip_outer_y - 2 * lid_lip_wall,
                    lid_lip_depth + 3 * eps
                ]);
        }
}

module snap_detent_x(x, y) {
    translate([x, y, lid_thickness + snap_detent_depth])
        rotate([90, 0, 0])
            cylinder(h = snap_detent_length, r = snap_detent_radius, center = true);
}

module lid_snap_detents() {
    lip_min_x = wall + lid_fit_clearance;
    lip_max_x = wall + lid_fit_clearance + lip_outer_x;

    for (y = snap_detent_y_positions) {
        snap_detent_x(lip_min_x, y);
        snap_detent_x(lip_max_x, y);
    }
}

module gps_boss(x, y) {
    translate([x, y, lid_thickness - eps])
        difference() {
            cylinder(h = gps_boss_h + eps, d = gps_boss_d);

            translate([0, 0, -eps])
                cylinder(h = gps_boss_h + 2 * eps, d = gps_pilot_d);
        }
}

module gps_bosses() {
    gps_boss(gps_center_x + gps_hole_left_dx, gps_center_y + gps_hole_dy);
    gps_boss(gps_center_x + gps_hole_right_dx, gps_center_y + gps_hole_dy);
}

module outside_etched_text(value, x, y, size) {
    translate([x, y, -eps])
        linear_extrude(height = etch_depth + eps)
            offset(delta = 0.01)
                mirror([1, 0, 0])
                    label_2d(value, size);
}

module outside_qr_etch() {
    qr_size = len(qr_matrix);

    for (r = [0 : qr_size - 1]) {
        for (c = [0 : qr_size - 1]) {
            if (qr_matrix[r][c] == 1) {
                translate([
                    qr_x + (qr_quiet_modules + qr_size - 1 - c) * qr_module - qr_overlap / 2,
                    qr_y + (qr_quiet_modules + qr_size - 1 - r) * qr_module - qr_overlap / 2,
                    -eps
                ])
                    cube([qr_module + qr_overlap, qr_module + qr_overlap, etch_depth + eps]);
            }
        }
    }
}

module outside_lid_etches() {
    outside_etched_text(title_text, outer_x / 2, outer_y - 6.8, 5.6);
    outside_etched_text(site_text, outer_x / 2, outer_y - 14.0, 3.0);
    outside_etched_text(gps_label_text, gps_center_x, gps_center_y + gps_opening / 2 + 4.7, 3.6);
    outside_etched_text(gps_sky_text_1, gps_center_x, gps_center_y - gps_opening / 2 - 2.6, 2.4);
    outside_etched_text(gps_sky_text_2, gps_center_x, gps_center_y - gps_opening / 2 - 5.8, 2.4);
    outside_qr_etch();
}

module lid() {
    difference() {
        union() {
            cube([outer_x, outer_y, lid_thickness]);
            lid_lip();
            lid_snap_detents();
            gps_bosses();
        }

        top_vent_cutouts();
        gps_opening_cutout();
        outside_lid_etches();
    }
}

if (part == "base") {
    base();
} else if (part == "lid") {
    lid();
} else {
    base();
    translate([0, outer_y + 10, 0]) lid();
}
