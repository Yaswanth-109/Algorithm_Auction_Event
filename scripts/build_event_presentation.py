from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt


OUT = "Algorithm_Auction_Event_Presentation.pptx"
prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

BG = RGBColor(8, 13, 20)
PANEL = RGBColor(15, 23, 34)
PANEL2 = RGBColor(19, 29, 42)
LINE = RGBColor(43, 58, 76)
LIME = RGBColor(199, 243, 106)
WHITE = RGBColor(239, 245, 250)
MUTED = RGBColor(156, 177, 199)
BLUE = RGBColor(97, 170, 231)
ORANGE = RGBColor(255, 188, 92)
FONT = "Aptos"
MONO = "Aptos Mono"


def rect(slide, x, y, w, h, fill=PANEL, stroke=None, radius=False):
    kind = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    sh = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid()
    sh.fill.fore_color.rgb = fill
    if stroke:
        sh.line.color.rgb = stroke
        sh.line.width = Pt(1)
    else:
        sh.line.fill.background()
    return sh


def line(slide, x1, y1, x2, y2, color=LINE, width=1.0):
    sh = slide.shapes.add_connector(1, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    sh.line.color.rgb = color
    sh.line.width = Pt(width)
    return sh


def text(slide, value, x, y, w, h, size=16, color=WHITE, bold=False,
         font=FONT, align=PP_ALIGN.LEFT, valign=MSO_ANCHOR.TOP,
         margin=0, italic=False, tracking=None):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.clear()
    tf.word_wrap = True
    tf.margin_left = Inches(margin)
    tf.margin_right = Inches(margin)
    tf.margin_top = Inches(margin)
    tf.margin_bottom = Inches(margin)
    tf.vertical_anchor = valign
    p = tf.paragraphs[0]
    p.alignment = align
    p.space_after = Pt(0)
    run = p.add_run()
    run.text = value
    run.font.name = font
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    if tracking is not None:
        run.font.spacing = Pt(tracking)
    return box


def background(slide, number, section):
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = BG
    # Quiet geometric rails echo the event platform without competing with copy.
    rect(slide, 0, 0, 0.09, 7.5, LIME)
    text(slide, "A", 0.37, 0.25, 0.34, 0.34, 19, LIME, True, align=PP_ALIGN.CENTER)
    text(slide, "ALGORITHM  AUCTION", 0.82, 0.28, 2.55, 0.28, 11, WHITE, True, tracking=0.6)
    text(slide, section.upper(), 9.55, 0.31, 2.65, 0.22, 9, MUTED, font=MONO, align=PP_ALIGN.RIGHT, tracking=0.6)
    text(slide, f"{number:02d}  /  10", 12.05, 0.31, 0.86, 0.22, 9, LIME, font=MONO, align=PP_ALIGN.RIGHT)
    line(slide, 0.42, 0.77, 12.92, 0.77, LINE, 0.8)
    line(slide, 0.42, 7.08, 12.92, 7.08, LINE, 0.8)
    text(slide, "BID SMART  ·  PLAY YOUR CARDS  ·  CRACK THE CODE", 0.45, 7.18, 6.8, 0.18, 8, MUTED, font=MONO, tracking=0.2)
    text(slide, "ALGORITHM AUCTION", 10.25, 7.18, 2.65, 0.18, 8, MUTED, font=MONO, align=PP_ALIGN.RIGHT, tracking=0.2)


def heading(slide, eyebrow, title, subtitle=None, y=1.12):
    text(slide, eyebrow.upper(), 0.62, y, 5.6, 0.23, 10, LIME, font=MONO, tracking=0.8)
    text(slide, title, 0.62, y + 0.34, 11.9, 0.65, 30, WHITE, True)
    if subtitle:
        text(slide, subtitle, 0.64, y + 1.08, 10.9, 0.48, 14, MUTED)


def label(slide, value, x, y, w=2.4, color=LIME):
    text(slide, value.upper(), x, y, w, 0.22, 9, color, font=MONO, tracking=0.8)


def bullet(slide, value, x, y, w, size=14, color=MUTED, dot=LIME):
    rect(slide, x, y + 0.12, 0.07, 0.07, dot)
    text(slide, value, x + 0.20, y, w - 0.20, 0.58, size, color)


def card(slide, x, y, w, h, index, title, body, accent=LIME, body_size=13):
    rect(slide, x, y, w, h, PANEL, LINE, True)
    rect(slide, x, y, 0.055, h, accent)
    text(slide, index, x + 0.22, y + 0.20, 0.45, 0.22, 9, accent, font=MONO)
    text(slide, title, x + 0.22, y + 0.56, w - 0.42, 0.40, 18, WHITE, True)
    text(slide, body, x + 0.22, y + 1.07, w - 0.44, h - 1.20, body_size, MUTED)


# 01 — Cover
s = prs.slides.add_slide(prs.slide_layouts[6])
s.background.fill.solid(); s.background.fill.fore_color.rgb = BG
rect(s, 0, 0, 0.1, 7.5, LIME)
text(s, "A", 0.65, 0.50, 0.48, 0.48, 27, LIME, True, align=PP_ALIGN.CENTER)
text(s, "ALGORITHM  AUCTION", 1.25, 0.58, 3.7, 0.28, 14, WHITE, True, tracking=0.8)
text(s, "EVENT BRIEFING  /  2026", 9.6, 0.66, 2.9, 0.2, 9, MUTED, font=MONO, align=PP_ALIGN.RIGHT, tracking=0.8)
line(s, 0.65, 1.15, 12.65, 1.15, LINE)
label(s, "90-minute strategy + programming arena", 0.75, 1.65, 5.2)
text(s, "BID SMART.", 0.72, 2.12, 7.6, 0.88, 47, WHITE, True)
text(s, "CRACK THE CODE.", 0.72, 3.02, 8.6, 0.95, 47, LIME, True)
text(s, "Two teammates. One shared workspace.\nA race to turn strategy into points.", 0.78, 4.32, 5.8, 0.78, 19, MUTED)
rect(s, 9.15, 1.75, 3.4, 4.65, PANEL, LINE, True)
text(s, "THE ARENA", 9.50, 2.08, 2.3, 0.23, 10, MUTED, font=MONO, tracking=1)
text(s, "90", 9.50, 2.58, 2.3, 1.00, 64, LIME, True)
text(s, "MINUTES", 9.55, 3.53, 2.0, 0.24, 11, WHITE, True, font=MONO, tracking=1)
line(s, 9.5, 4.02, 12.15, 4.02, LINE)
text(s, "02", 9.50, 4.28, 0.75, 0.60, 28, WHITE, True)
text(s, "TEAMMATES", 10.35, 4.47, 1.7, 0.20, 10, MUTED, font=MONO, tracking=0.6)
text(s, "1,000", 9.50, 5.16, 1.60, 0.50, 25, WHITE, True, font=MONO)
text(s, "STARTING CREDITS", 9.52, 5.76, 2.5, 0.20, 9, MUTED, font=MONO, tracking=0.5)
line(s, 0.75, 6.47, 8.0, 6.47, LINE)
text(s, "POWER CARDS  →  ALGORITHMS  →  CODING  →  LEADERBOARD", 0.78, 6.66, 7.65, 0.22, 10, MUTED, font=MONO, tracking=0.3)
text(s, "01  /  10", 11.35, 7.08, 1.1, 0.2, 9, MUTED, font=MONO, align=PP_ALIGN.RIGHT)

# 02 — Overview timeline
s = prs.slides.add_slide(prs.slide_layouts[6]); background(s, 2, "The event")
heading(s, "The full run", "Three stages. One team score.", "The host controls the pace; your team makes the strategic calls.")
line(s, 1.15, 3.36, 12.15, 3.36, LINE, 2)
stages = [
    (0.85, "01", "POWER CARD\nAUCTION", "Bid for a strategic\nadvantage.", LIME),
    (4.75, "02", "ALGORITHM\nAUCTION", "Win problem allotments\none at a time.", BLUE),
    (8.65, "03", "CODING\nROUND", "Solve, submit, and\nwatch the standings.", ORANGE),
]
for x, num, title, desc, accent in stages:
    rect(s, x + 0.10, 3.16, 0.40, 0.40, accent, radius=True)
    text(s, num, x + 0.11, 3.25, 0.38, 0.15, 9, BG, True, font=MONO, align=PP_ALIGN.CENTER)
    label(s, f"STAGE {num}", x, 2.47, 1.6, accent)
    text(s, title, x, 3.83, 3.25, 0.78, 20, WHITE, True)
    text(s, desc, x, 4.78, 3.35, 0.60, 14, MUTED)
rect(s, 0.85, 5.78, 11.7, 0.72, PANEL2, LINE, True)
text(s, "EVENT LENGTH", 1.15, 6.03, 1.65, 0.18, 9, MUTED, font=MONO, tracking=0.5)
text(s, "90 minutes", 2.95, 5.96, 1.55, 0.32, 16, WHITE, True)
text(s, "TEAM SIZE", 5.15, 6.03, 1.15, 0.18, 9, MUTED, font=MONO, tracking=0.5)
text(s, "2 members", 6.48, 5.96, 1.45, 0.32, 16, WHITE, True)
text(s, "STARTING BUDGET", 8.65, 6.03, 1.75, 0.18, 9, MUTED, font=MONO, tracking=0.5)
text(s, "1,000 credits", 10.45, 5.96, 1.78, 0.32, 16, LIME, True)

# 03 — Team shared workspace
s = prs.slides.add_slide(prs.slide_layouts[6]); background(s, 3, "Your team")
heading(s, "Built for two", "Your teammate is in the same run.", "Both accounts work inside one team workspace, with the same code and the same clock.")
rect(s, 0.72, 2.82, 4.25, 3.52, PANEL, LINE, True)
label(s, "MEMBER 01", 1.05, 3.17, 1.7, BLUE)
text(s, "You", 1.05, 3.55, 2.6, 0.60, 27, WHITE, True)
rect(s, 1.05, 4.35, 3.6, 0.68, PANEL2, LINE, True)
text(s, "CODE  ·  RUN  ·  SUBMIT", 1.27, 4.58, 3.1, 0.2, 11, MUTED, font=MONO, tracking=0.4)
label(s, "MEMBER 02", 1.05, 5.33, 1.7, BLUE)
text(s, "Your teammate", 1.05, 5.67, 3.2, 0.42, 18, WHITE, True)
line(s, 5.35, 4.57, 6.18, 4.57, LIME, 2.5)
rect(s, 6.18, 3.94, 0.85, 1.25, LIME, radius=True)
text(s, "↔", 6.25, 4.22, 0.7, 0.60, 30, BG, True, align=PP_ALIGN.CENTER)
line(s, 7.03, 4.57, 7.85, 4.57, LIME, 2.5)
rect(s, 7.85, 2.82, 4.75, 3.52, PANEL, LINE, True)
label(s, "ONE SHARED WORKSPACE", 8.2, 3.17, 3.2)
text(s, "Live co-editing", 8.2, 3.57, 3.9, 0.50, 23, WHITE, True)
bullet(s, "Both members see code changes live.", 8.2, 4.38, 3.95)
bullet(s, "The algorithm timer is shared.", 8.2, 5.05, 3.95)
bullet(s, "Either member can run or submit.", 8.2, 5.72, 3.95)

# 04 — In-person auction
s = prs.slides.add_slide(prs.slide_layouts[6]); background(s, 4, "The auction")
heading(s, "Bidding is in the room", "Think before you raise your bid.", "The administrator records the physical auction result and allocates the item in the platform.")
card(s, 0.75, 2.70, 3.75, 3.10, "01", "Set a budget", "Your team begins with 1,000 credits. Keep enough for the items that matter most.", LIME)
card(s, 4.78, 2.70, 3.75, 3.10, "02", "Win an item", "The host calls the winning bid. Confirm the result with the administrator.", BLUE)
card(s, 8.80, 2.70, 3.75, 3.10, "03", "See it in your account", "The administrator records the spend and assigns the card or algorithm to your team.", ORANGE)
rect(s, 0.75, 6.10, 11.8, 0.48, PANEL2, LINE, True)
text(s, "ALGORITHM ALLOTMENTS ARE ENTERED ONE BY ONE  ·  MAXIMUM 2 PER TEAM", 1.02, 6.23, 11.25, 0.20, 10, LIME, font=MONO, align=PP_ALIGN.CENTER, tracking=0.4)

# 05 — Power cards
s = prs.slides.add_slide(prs.slide_layouts[6]); background(s, 5, "Power cards")
heading(s, "Play your cards", "A small edge can change the round.", "Review each published card’s image and effect before the auction; the card listing defines its actual effect.")
examples = [
    (0.75, "✦", "HINT", "A clue to help your team move past a tough step.", ORANGE),
    (3.78, "↗", "TIME EXTENSION", "Some cards can add time to an active algorithm.", LIME),
    (6.81, "◎", "SPECIAL ADVANTAGE", "A card may change how your team approaches an item.", BLUE),
    (9.84, "?", "MYSTERY EFFECT", "Some effects are revealed during the event.", RGBColor(203, 131, 255)),
]
for x, icon, title, body, accent in examples:
    rect(s, x, 3.06, 2.72, 2.75, PANEL, LINE, True)
    rect(s, x + 0.23, 3.30, 0.62, 0.62, PANEL2, accent, True)
    text(s, icon, x + 0.27, 3.39, 0.54, 0.33, 20, accent, True, align=PP_ALIGN.CENTER)
    text(s, title, x + 0.23, 4.18, 2.25, 0.46, 14, WHITE, True)
    text(s, body, x + 0.23, 4.82, 2.23, 0.68, 12, MUTED)
text(s, "Cards shown here are examples of effect types—not a promise that every card is in this event’s published catalog.", 0.85, 6.16, 11.6, 0.37, 11, MUTED, italic=True, align=PP_ALIGN.CENTER)

# 06 — Algorithm assignment and coding timer
s = prs.slides.add_slide(prs.slide_layouts[6]); background(s, 6, "Algorithm round")
heading(s, "From allotment to editor", "Open one problem and own the clock.", "Your administrator assigns the problems your team won, one at a time.")
rect(s, 0.75, 2.82, 5.34, 3.62, PANEL, LINE, True)
label(s, "YOUR PROBLEM", 1.08, 3.14, 1.9, BLUE)
text(s, "Up to 2", 1.08, 3.56, 2.8, 0.68, 31, WHITE, True)
text(s, "algorithm assignments", 1.10, 4.27, 3.8, 0.28, 15, MUTED)
line(s, 1.1, 4.92, 5.65, 4.92, LINE)
bullet(s, "Open the assignment from My Allotments.", 1.10, 5.16, 4.45, 12)
bullet(s, "The first teammate to start begins the shared timer.", 1.10, 5.77, 4.45, 12)
rect(s, 6.45, 2.82, 6.10, 3.62, PANEL, LINE, True)
label(s, "SERVER-TIMED SPRINT", 6.8, 3.14, 2.7)
text(s, "20:00", 6.78, 3.48, 2.6, 0.86, 43, LIME, True, font=MONO)
text(s, "DEFAULT PER ALGORITHM", 9.34, 3.87, 2.4, 0.20, 10, MUTED, font=MONO, tracking=0.4)
line(s, 6.8, 4.53, 12.17, 4.53, LINE)
text(s, "Need more time?", 6.82, 4.87, 2.65, 0.35, 17, WHITE, True)
text(s, "The administrator can extend a particular team’s active algorithm timer.", 6.82, 5.38, 4.95, 0.69, 13, MUTED)
text(s, "Your configured timer may differ.", 6.82, 6.08, 4.5, 0.20, 10, BLUE, font=MONO)

# 07 — Languages and collaboration
s = prs.slides.add_slide(prs.slide_layouts[6]); background(s, 7, "Coding platform")
heading(s, "Build together", "One editor. Four languages.", "Choose a language, collaborate live, and keep your solution moving toward a tested submission.")
rect(s, 0.75, 2.75, 7.05, 3.78, PANEL, LINE, True)
rect(s, 1.02, 3.03, 6.50, 0.53, PANEL2, LINE, True)
text(s, "TEAM WORKSPACE", 1.25, 3.20, 2.2, 0.16, 9, MUTED, font=MONO, tracking=0.7)
text(s, "LIVE  ●", 6.25, 3.20, 0.95, 0.16, 9, LIME, font=MONO, align=PP_ALIGN.RIGHT)
text(s, "def solve():", 1.30, 3.95, 4.5, 0.32, 18, BLUE, font=MONO)
text(s, "    # your shared solution", 1.30, 4.47, 5.2, 0.32, 17, MUTED, font=MONO)
text(s, "    print(answer)", 1.30, 4.99, 5.0, 0.32, 18, LIME, font=MONO)
line(s, 1.28, 5.70, 7.50, 5.70, LINE)
text(s, "AUTOSAVE  ·  LIVE CO-EDITING  ·  SHARED TIMER", 1.30, 5.99, 5.9, 0.18, 9, MUTED, font=MONO, tracking=0.45)
rect(s, 8.15, 2.75, 4.40, 3.78, PANEL, LINE, True)
label(s, "PICK YOUR TOOL", 8.49, 3.12, 2.1)
langs = [("PY", "Python"), ("JV", "Java"), ("C", "C"), ("C++", "C++")]
for i, (symbol, name) in enumerate(langs):
    yy = 3.65 + i * 0.62
    rect(s, 8.49, yy, 0.58, 0.43, PANEL2, LINE, True)
    text(s, symbol, 8.52, yy + 0.10, 0.52, 0.16, 9, LIME, True, font=MONO, align=PP_ALIGN.CENTER)
    text(s, name, 9.30, yy + 0.08, 2.1, 0.22, 15, WHITE, True)
text(s, "The language selection is shared by both teammates.", 8.50, 6.17, 3.55, 0.32, 10, MUTED)

# 08 — Score mechanics
s = prs.slides.add_slide(prs.slide_layouts[6]); background(s, 8, "Scoring")
heading(s, "Every point has a source", "Solve well. Finish early. Save credits.", "The public leaderboard combines solution, timing, and credit bonus points.")
card(s, 0.75, 2.76, 3.74, 2.45, "01", "SOLUTION", "Earn points from the official test cases. RUN is for practice; SUBMIT is scored.", LIME, 12)
card(s, 4.80, 2.76, 3.74, 2.45, "02", "TIMING", "A full accepted solution earns 0.5 point for every complete 10 seconds left.", BLUE, 12)
card(s, 8.84, 2.76, 3.74, 2.45, "03", "CREDIT BONUS", "Remaining credits become bonus points when the admin opens coding.", ORANGE, 12)
rect(s, 0.75, 5.57, 11.83, 0.94, PANEL2, LINE, True)
text(s, "EXAMPLE  ·  20-MINUTE PROBLEM", 1.05, 5.81, 2.9, 0.18, 9, MUTED, font=MONO, tracking=0.5)
text(s, "Solved in 12:12", 4.13, 5.75, 1.98, 0.26, 14, WHITE, True)
text(s, "7:48 left  →  23 timing pts", 6.25, 5.75, 2.9, 0.26, 14, LIME, True)
text(s, "Default credit bonus: 10 unused credits = 1 point (rounded down).", 9.00, 5.73, 3.18, 0.46, 10, MUTED)
text(s, "Timing: floor(remaining seconds ÷ 10) × 0.5. Five seconds left adds no timing point.", 1.07, 6.68, 11.1, 0.18, 9, MUTED, font=MONO)

# 09 — Submit safely
s = prs.slides.add_slide(prs.slide_layouts[6]); background(s, 9, "Submission")
heading(s, "Test, then submit", "Practice freely. Submit deliberately.", "Use the coding platform’s separate actions for practice and official evaluation.")
rect(s, 0.78, 2.88, 5.62, 3.38, PANEL, LINE, True)
rect(s, 1.12, 3.22, 1.00, 0.42, PANEL2, BLUE, True)
text(s, "RUN", 1.15, 3.33, 0.94, 0.16, 10, BLUE, True, font=MONO, align=PP_ALIGN.CENTER)
text(s, "Check your approach", 1.12, 3.96, 4.5, 0.38, 21, WHITE, True)
bullet(s, "Try sample cases or your own input.", 1.12, 4.66, 4.70)
bullet(s, "Read the output or compiler feedback.", 1.12, 5.30, 4.70)
text(s, "RUN does not change your official score.", 1.12, 5.91, 4.65, 0.22, 10, BLUE, font=MONO)
rect(s, 6.90, 2.88, 5.62, 3.38, PANEL, LINE, True)
rect(s, 7.24, 3.22, 1.30, 0.42, LIME, radius=True)
text(s, "SUBMIT", 7.27, 3.33, 1.24, 0.16, 10, BG, True, font=MONO, align=PP_ALIGN.CENTER)
text(s, "Send for official scoring", 7.24, 3.96, 4.7, 0.38, 21, WHITE, True)
bullet(s, "Hidden test cases check your solution.", 7.24, 4.66, 4.72)
bullet(s, "Points follow the problem’s test weights.", 7.24, 5.30, 4.72)
text(s, "Submit before the shared timer ends.", 7.24, 5.91, 4.6, 0.22, 10, LIME, font=MONO)

# 10 — LED / closing
s = prs.slides.add_slide(prs.slide_layouts[6]); background(s, 10, "The big screen")
heading(s, "Follow the event live", "Three views for the room.", "The LED display keeps teams and spectators in sync with the event.")
views = [
    (0.78, "01", "PUBLISHED", "Browse the power cards and algorithms released by the admin.", BLUE),
    (4.79, "02", "SPOTLIGHT", "See the power card or algorithm currently on display.", LIME),
    (8.80, "03", "LEADERBOARD", "Track the live team standings and total points.", ORANGE),
]
for x, n, title, body, accent in views:
    rect(s, x, 3.01, 3.72, 2.48, PANEL, LINE, True)
    text(s, n, x + 0.26, 3.27, 0.55, 0.32, 17, accent, True, font=MONO)
    text(s, title, x + 0.26, 3.82, 3.05, 0.34, 18, WHITE, True)
    text(s, body, x + 0.26, 4.40, 3.12, 0.70, 13, MUTED)
rect(s, 0.78, 5.93, 11.74, 0.70, LIME, radius=True)
text(s, "PLAN TOGETHER.  BID WITH PURPOSE.  MAKE EVERY SUBMISSION COUNT.", 1.03, 6.17, 11.25, 0.19, 12, BG, True, font=MONO, align=PP_ALIGN.CENTER, tracking=0.4)

prs.save(OUT)
print(f"Created {OUT} with {len(prs.slides)} slides")
