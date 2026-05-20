# CrowdPM Node Case

Two-piece 3D-printable enclosure for a node with a clear inside cavity of
3.25 in x 3.00 in x 1.25 in.

## Files

- `node_case.scad`: Parametric OpenSCAD source.
- `node_case_base.stl`: Open base with +Y side airflow slots, -X USB cutout, -X reset button hole, Raspberry Pi Zero 2 W standoffs, and chamfered rim/port edges.
- `node_case_lid.stl`: Vented snap-detent lid with a GPS antenna opening, GPS mounting bosses, and etched outside E-face product/GPS/site markings. The lid STL has the lip pointing upward so it can print without supports.
- `node_case_combined.scad`: Wrapper that builds the base and lid from the parametric source modules onto one build plate, avoiding STL-on-STL boolean artifacts.
- `node_case_combined.stl`: Base and lid on one build plate with a 10 mm gap. This combined-only export adds two long thin slots through the base bottom.

## Current Defaults

- Clear inside cavity: 3.25 in x 3.00 in x 1.25 in.
- Outside footprint: 86.55 mm x 80.20 mm, or about 3.41 in x 3.16 in.
- Assembled outside height: 35.75 mm, or about 1.41 in.
- Combined STL build-plate bounds: 86.55 mm x 170.40 mm x 33.75 mm, or about 3.41 in x 6.71 in x 1.33 in.
- Combined-only base bottom slots: two 46.00 mm x 4.00 mm rounded slots through the 2.00 mm floor, at Y = 22.00 mm and Y = 58.00 mm.
- Wall thickness: 2.0 mm.
- Chamfers: 0.60 mm base rim and lid-lip lead-in chamfers, plus 0.80 mm USB/reset opening chamfers on the outside B / -X face.
- Lid fit clearance: 0.50 mm, so normal retention comes from snap detents rather than pressure fit.
- Lid latch: four rounded 0.70 mm radius detent beads on the A/B lip faces, matching rounded grooves inside the base with 0.18 mm groove clearance.
- Release feature: D / -Y top rim pry notch for unlatching.
- Top face airflow: six rounded slots, shifted left to avoid the GPS opening.
- Face orientation convention: A = +X, B = -X, C = +Y, D = -Y, E = lid top/outside face. A/B/C/D face letters are no longer engraved.
- E face etching: `Crowd PM Node`, `GPS`, `This side` / `towards sky.`, `crowdpmplatform.web.app`, and a compact low-error-correction QR code for `https://crowdpmplatform.web.app`.
- E face layout: product title and URL are centered on the lid top. GPS label, GPS opening, sky-direction text, and QR remain aligned on the GPS centerline at X = 65.05 mm.
- GPS group vertical position: GPS label/opening/mounts/sky-direction text are shifted down to balance the gap between the URL and QR.
- E face etch depth: 0.75 mm, intended for white filament with black acrylic paint or black marker rubbed into the recesses and wiped clean.
- QR code: 0.95 mm modules with a 4-module quiet border, sized to fit below the GPS opening.
- C / +Y side airflow: four vertical rounded slots on the 3.25 in x 1.25 in face, shifted toward the Y-axis / B-side edge with the first slot edge at X = 2.0 mm to avoid long wall bridges.
- B / -X USB opening: 14.5 mm x 8.0 mm rectangular clearance with a peaked 45-degree relief above it to avoid a wall bridge, now on the lower-Y side and lowered slightly toward the base bottom.
- B / -X reset opening: 5.5 mm round, on the higher-Y side of the USB opening with a 6.0 mm edge gap, also lowered slightly toward the base bottom.
- Raspberry Pi Zero 2 W board reference: 65 mm x 30 mm, with mounting holes inset 3.5 mm from each edge.
- Raspberry Pi standoff pattern: rotated 90 degrees and pushed toward A / +X and D / -Y with 0.5 mm board-edge clearance from the inside walls.
- Raspberry Pi standoffs: 0.25 in tall, 6.5 mm outside diameter, 2.2 mm pilot holes for M2.5-style screws.
- GPS lid opening: 10/16 in x 10/16 in, or 15.875 mm x 15.875 mm, shifted upward to leave room for the two-line sky-direction etching underneath.
- GPS reference board: Adafruit Ultimate GPS breakout style, using a 15 mm x 15 mm patch antenna and two mounting holes spaced 0.8 in apart.
- GPS lid bosses: 6.0 mm outside diameter with 2.2 mm screw pilot holes. Boss centers match the Adafruit Ultimate GPS Eagle board mounting holes at X = 2.54 mm / 22.86 mm and Y = 31.75 mm, referenced from the U1 antenna/module center at X = 12.192 mm and Y = 17.526 mm. The current GPS PCB mounting holes are 2.5 mm.

## Regenerate STLs

```sh
openscad -o node_case_base.stl -D 'part="base"' node_case.scad
openscad -o node_case_lid.stl  -D 'part="lid"'  node_case.scad
```

Adjust the parameters at the top of `node_case.scad` if the USB connector,
reset button, wall thickness, or fit clearance needs tuning for your printer.

## References Used

- Raspberry Pi Zero 2 W mechanical drawing: https://datasheets.raspberrypi.com/rpizero2/raspberry-pi-zero-2-w-mechanical-drawing.pdf
- Adafruit Ultimate GPS product dimensions and antenna size: https://www.adafruit.com/product/746
- Adafruit Ultimate GPS fabrication print: https://learn.adafruit.com/adafruit-ultimate-gps/downloads
- Snap-fit design guidance: https://www.hubs.com/knowledge-base/how-design-snap-fit-joints-3d-printing/
- FDM snap-fit tolerance guidance: https://3dspro.com/resources/3dspro-lab/how-to-design-snap-fit-geometry-for-3d-printing
