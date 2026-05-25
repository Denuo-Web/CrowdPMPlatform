// Self-contained OpenSCAD wrapper for the generated combined case STL.
//
// The original parametric source file `node_case.scad` is not present in this
// directory, so the previous wrapper opened with missing-library warnings and
// showed incomplete geometry. Importing the generated STL keeps this file
// directly openable in OpenSCAD.

import("node_case_combined.stl", convexity = 10);
