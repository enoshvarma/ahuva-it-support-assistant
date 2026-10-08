"""Generates the bundled demo drawing (assets/sample-house.dxf) used by the
"Open sample" button and by the rendering tests. Requires: pip install ezdxf"""
import math
import sys
import ezdxf
from ezdxf.enums import TextEntityAlignment, MTextEntityAlignment
from ezdxf.math import Vec2
from ezdxf.render import mleader

out = sys.argv[1] if len(sys.argv) > 1 else "assets/sample-house.dxf"
doc = ezdxf.new("R2018", setup=True)  # setup=True adds linetypes, text & dim styles
doc.header["$INSUNITS"] = 4  # millimetres
msp = doc.modelspace()

layers = {
    "WALLS": (7, "Continuous", 50),
    "DOORS": (3, "Continuous", 25),
    "WINDOWS": (4, "Continuous", 25),
    "CENTER": (1, "CENTER", 18),
    "HIDDEN": (6, "HIDDEN", 18),
    "DIMS": (2, "Continuous", 18),
    "TEXT": (7, "Continuous", 25),
    "HATCH": (8, "Continuous", 13),
    "FURNITURE": (30, "Continuous", 18),
    "GRID": (9, "DASHDOT", 13),
    "FROZEN-NOTES": (5, "Continuous", 25),
}
for name, (color, lt, lw) in layers.items():
    l = doc.layers.add(name, color=color, linetype=lt)
    l.dxf.lineweight = lw
doc.layers.get("FROZEN-NOTES").freeze()

# --- outer walls (wide polyline) and inner walls -------------------------------
W, H = 12000, 8000
msp.add_lwpolyline([(0, 0), (W, 0), (W, H), (0, H)], close=True, dxfattribs={"layer": "WALLS", "const_width": 200})
msp.add_line((5000, 0), (5000, 5200), dxfattribs={"layer": "WALLS", "lineweight": 35})
msp.add_line((5000, 6200), (5000, H), dxfattribs={"layer": "WALLS", "lineweight": 35})
msp.add_line((0, 4500), (3800, 4500), dxfattribs={"layer": "WALLS", "lineweight": 35})
msp.add_line((5000, 4000), (W, 4000), dxfattribs={"layer": "WALLS", "lineweight": 35})

# --- wall hatch (pattern) and floor hatch (solid / gradient) -------------------
h = msp.add_hatch(color=8, dxfattribs={"layer": "HATCH"})
h.set_pattern_fill("ANSI31", scale=40, angle=0)
h.paths.add_polyline_path([(0, 0), (W, 0), (W, H), (0, H)], is_closed=True, flags=1)
h.paths.add_polyline_path([(100, 100), (W - 100, 100), (W - 100, H - 100), (100, H - 100)], is_closed=True, flags=16)

bath = msp.add_hatch(color=151, dxfattribs={"layer": "HATCH"})
bath.paths.add_polyline_path([(5100, 4100), (7500, 4100), (7500, 5800), (5100, 5800)], is_closed=True)

grad = msp.add_hatch(dxfattribs={"layer": "HATCH"})
grad.set_gradient((255, 230, 180), (255, 150, 60), rotation=30)
ep = grad.paths.add_edge_path()
ep.add_line((9000, 5000), (11000, 5000))
ep.add_arc((11000, 6000), radius=1000, start_angle=270, end_angle=90)
ep.add_line((11000, 7000), (9000, 7000))
ep.add_line((9000, 7000), (9000, 5000))

tiles = msp.add_hatch(color=252, dxfattribs={"layer": "HATCH"})
tiles.set_pattern_fill("NET", scale=60)
tiles.paths.add_polyline_path([(200, 200), (3000, 200), (3000, 2500), (200, 2500)], is_closed=True)
tiles.paths.add_edge_path().add_ellipse((1600, 1350), major_axis=(800, 0), ratio=0.5)

# --- blocks: door with arc, window, table+chairs (nested), title attribs ---------
door = doc.blocks.new("DOOR", base_point=(0, 0))
door.add_line((0, 0), (900, 0), dxfattribs={"layer": "0"})
door.add_arc((0, 0), 900, 0, 90, dxfattribs={"layer": "0"})
door.add_line((0, 0), (0, 900), dxfattribs={"layer": "0", "color": 0})

win = doc.blocks.new("WINDOW")
for y in (0, 60, 140, 200):
    win.add_line((0, y), (1200, y))

chair = doc.blocks.new("CHAIR")
chair.add_lwpolyline([(-200, -200), (200, -200), (200, 200), (-200, 200)], close=True)
chair.add_lwpolyline([(-200, 200), (200, 200)], dxfattribs={"const_width": 60})

table = doc.blocks.new("TABLE4")
table.add_circle((0, 0), 500, dxfattribs={"layer": "FURNITURE"})
for i in range(4):
    a = i * 90
    table.add_blockref("CHAIR", (math.cos(math.radians(a)) * 750, math.sin(math.radians(a)) * 750), dxfattribs={"rotation": a + 90})

tag = doc.blocks.new("ROOMTAG")
tag.add_circle((0, 0), 350)
tag.add_attdef("NAME", (0, 60), dxfattribs={"height": 120}).set_placement((0, 60), align=TextEntityAlignment.BOTTOM_CENTER)
tag.add_attdef("AREA", (0, -60), dxfattribs={"height": 90}).set_placement((0, -60), align=TextEntityAlignment.TOP_CENTER)

msp.add_blockref("DOOR", (5000, 5200), dxfattribs={"layer": "DOORS", "rotation": 0})
msp.add_blockref("DOOR", (3800, 4500), dxfattribs={"layer": "DOORS", "xscale": -1})  # mirrored
msp.add_blockref("DOOR", (2000, 0), dxfattribs={"layer": "DOORS", "color": 1})
for x in (1500, 7000, 9500):
    msp.add_blockref("WINDOW", (x, H - 100), dxfattribs={"layer": "WINDOWS"})
msp.add_blockref("WINDOW", (W - 100, 1500), dxfattribs={"layer": "WINDOWS", "rotation": 90})
msp.add_blockref("TABLE4", (8500, 2000), dxfattribs={"layer": "FURNITURE"})
m = msp.add_blockref("CHAIR", (600, 6000), dxfattribs={"layer": "FURNITURE"})
m.grid(size=(2, 4), spacing=(600, 600))  # MINSERT

for name, area, pos in (("LIVING", "38.5 m²", (8500, 6500)), ("BEDROOM", "21.4 m²", (2400, 6200)), ("KITCHEN", "17.0 m²", (2400, 2600))):
    ref = msp.add_blockref("ROOMTAG", pos, dxfattribs={"layer": "TEXT"})
    ref.add_auto_attribs({"NAME": name, "AREA": area})

# --- centre lines / hidden / grid with linetypes -------------------------------
msp.add_line((-800, 4000), (W + 800, 4000), dxfattribs={"layer": "CENTER", "ltscale": 20})
msp.add_line((6000, -800), (6000, H + 800), dxfattribs={"layer": "CENTER", "ltscale": 20})
msp.add_circle((8500, 2000), 1300, dxfattribs={"layer": "HIDDEN", "ltscale": 15})
for i, x in enumerate(range(0, W + 1, 3000)):
    msp.add_line((x, -1500), (x, -900), dxfattribs={"layer": "GRID"})
    msp.add_circle((x, -1800), 300, dxfattribs={"layer": "GRID", "linetype": "Continuous"})
    msp.add_text(chr(65 + i), height=250, dxfattribs={"layer": "GRID"}).set_placement((x, -1800), align=TextEntityAlignment.MIDDLE_CENTER)

# --- curves --------------------------------------------------------------------
msp.add_ellipse((11000, -1800), major_axis=(800, 200), ratio=0.4, start_param=0, end_param=math.pi * 1.5, dxfattribs={"color": 5})
msp.add_spline([(0, 9000), (1500, 10000), (3000, 9000), (4500, 10200), (6000, 9300)], dxfattribs={"color": 6})
msp.add_spline_control_frame([(7000, 9000), (8000, 10200), (9500, 9000), (11000, 10000)], dxfattribs={"color": 4})
msp.add_lwpolyline([(0, 11000, 0, 0, 0.5), (2000, 11000, 0, 0, -0.5), (4000, 11000, 0, 0, 0)], format="xyseb", dxfattribs={"color": 3})
msp.add_lwpolyline([(5000, 11000, 0, 300, 0), (6500, 11000, 0, 0, 0)], format="xyseb", dxfattribs={"color": 1})  # arrow (tapered)
msp.add_arc((9000, 11000), 800, 200, 340, dxfattribs={"color": 2}).dxf.extrusion = (0, 0, -1)  # OCS mirrored arc
msp.add_point((11500, 11000), dxfattribs={"color": 1})
msp.add_solid([(11800, 10800), (12300, 10800), (11800, 11300), (12300, 11300)], dxfattribs={"color": 5})

# --- texts: alignments, mtext formatting, special chars, rotated -------------------
msp.add_text("Left baseline", height=200, dxfattribs={"layer": "TEXT"}).set_placement((0, 12500))
msp.add_text("Centered", height=200, dxfattribs={"layer": "TEXT"}).set_placement((6000, 12500), align=TextEntityAlignment.CENTER)
msp.add_text("Right", height=200, dxfattribs={"layer": "TEXT"}).set_placement((12000, 12500), align=TextEntityAlignment.RIGHT)
msp.add_text("Fit between points", height=200, dxfattribs={"layer": "TEXT"}).set_placement((0, 13200), (5000, 13200), align=TextEntityAlignment.FIT)
msp.add_text("Rotated 30%%d %%c50 %%p0.5", height=180, rotation=30, dxfattribs={"layer": "TEXT"}).set_placement((7000, 13000))
mt = msp.add_mtext("DWG Viewer demo\\P{\\C1;Red} and {\\C5;blue} words\\PSecond paragraph with a long sentence that should wrap inside the box width.", dxfattribs={"layer": "TEXT", "char_height": 180, "width": 4000})
mt.set_location((0, 15500), attachment_point=MTextEntityAlignment.TOP_LEFT)
mt2 = msp.add_mtext("Middle centre\\PMTEXT", dxfattribs={"layer": "TEXT", "char_height": 200})
mt2.set_location((9000, 14500), attachment_point=MTextEntityAlignment.MIDDLE_CENTER)
msp.add_mtext("Unicode: Привет 你好 مرحبا", dxfattribs={"layer": "TEXT", "char_height": 200}).set_location((0, 16500))
msp.add_text("This note is on a frozen layer", height=200, dxfattribs={"layer": "FROZEN-NOTES"}).set_placement((0, -3000))

# --- dimensions ------------------------------------------------------------------
dim = msp.add_linear_dim(base=(0, -600), p1=(0, 0), p2=(5000, 0), dimstyle="EZDXF", override={"dimtxt": 200, "dimasz": 150, "dimexe": 80, "dimexo": 80}, dxfattribs={"layer": "DIMS"})
dim.render()
msp.add_linear_dim(base=(5000, -600), p1=(5000, 0), p2=(W, 0), dimstyle="EZDXF", override={"dimtxt": 200, "dimasz": 150}, dxfattribs={"layer": "DIMS"}).render()
msp.add_linear_dim(base=(W + 600, 0), p1=(W, 0), p2=(W, H), angle=90, dimstyle="EZDXF", override={"dimtxt": 200, "dimasz": 150}, dxfattribs={"layer": "DIMS"}).render()
msp.add_aligned_dim(p1=(5000, 11000), p2=(6500, 11000), distance=500, dimstyle="EZDXF", override={"dimtxt": 150, "dimasz": 100}, dxfattribs={"layer": "DIMS"}).render()
msp.add_radius_dim(center=(8500, 2000), radius=1300, angle=45, dimstyle="EZ_RADIUS", override={"dimtxt": 200, "dimasz": 150}, dxfattribs={"layer": "DIMS"}).render()
msp.add_angular_dim_2l(base=(9800, 11600), line1=((9000, 11000), (9800, 11500)), line2=((9000, 11000), (9900, 11000)), dimstyle="EZDXF", override={"dimtxt": 150, "dimasz": 100}, dxfattribs={"layer": "DIMS"}).render()

# --- leader + multileader ----------------------------------------------------------
msp.add_leader([(4000, 7000), (4500, 7500), (5200, 7500)], dimstyle="EZDXF", override={"dimasz": 150}, dxfattribs={"layer": "DIMS"})
ml = msp.add_multileader_mtext("Standard", dxfattribs={"layer": "DIMS"})
ml.set_content("Fire exit", char_height=180, alignment=1)
ml.add_leader_line(mleader.ConnectionSide.left, [Vec2(11500, 300)])  # left side
ml.build(insert=Vec2(10000, 1000))

# --- wipeout masking a line ----------------------------------------------------------
msp.add_line((0, 18000), (6000, 18000), dxfattribs={"color": 1})
msp.add_wipeout([(2500, 17700), (3500, 17700), (3500, 18300), (2500, 18300)])
msp.add_text("MASK", height=200).set_placement((3000, 18000), align=TextEntityAlignment.MIDDLE_CENTER)

# --- paper space layout with two viewports ---------------------------------------------
layout = doc.layouts.new("A3 Sheet")
layout.page_setup(size=(420, 297), margins=(10, 10, 10, 10), units="mm")
layout.add_lwpolyline([(10, 10), (410, 10), (410, 287), (10, 287)], close=True, dxfattribs={"const_width": 0.7})
layout.add_lwpolyline([(290, 10), (410, 10), (410, 50), (290, 50)], close=True)
layout.add_text("DWG VIEWER SAMPLE", height=6).set_placement((350, 35), align=TextEntityAlignment.MIDDLE_CENTER)
layout.add_text("Scale 1:50", height=4).set_placement((350, 20), align=TextEntityAlignment.MIDDLE_CENTER)
layout.add_viewport(center=(150, 150), size=(260, 220), view_center_point=(6000, 4000), view_height=11000)
layout.add_viewport(center=(350, 170), size=(100, 100), view_center_point=(8500, 2000), view_height=3500)

doc.saveas(out)
print("wrote", out)
