"""Builds the Ultrahuman tester briefing PDF.

A one-page-ish handout for somebody who owns an Ultrahuman ring and might help
us test the sync. Written for THEM, not for us: no SQL, no admin console, and
nothing they cannot check on their own two screens.

    pip install reportlab
    python3 scripts/build-tester-brief.py

Output: docs/outreach/Ikigaro-Ultrahuman-tester-brief.pdf

WHY THE FOUR CHECKS ARE THE FOUR CHECKS. Each one is a mapping decision made
from Ultrahuman's documented example rather than from real data, and each has a
plausible wrong answer: sleep arrives in seconds, steps live under `total` and
not `avg`, there are two HRV fields and two sleep scores. A tester comparing
these four against their own app is the cheapest way to find out which, if any,
we read wrongly. See docs/WEARABLES.md.
"""

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

OUT = "docs/outreach/Ikigaro-Ultrahuman-tester-brief.pdf"

INK = colors.HexColor("#1A1A1A")
MUTED = colors.HexColor("#5F5F5F")
RULE = colors.HexColor("#D8D4CC")
ACCENT = colors.HexColor("#8A6A3B")
BAND = colors.HexColor("#F4F1EA")

styles = getSampleStyleSheet()


def s(name, **kw):
    base = dict(name=name, fontName="Helvetica", fontSize=9.5, leading=13.5,
                textColor=INK, alignment=TA_LEFT)
    base.update(kw)
    return ParagraphStyle(**base)


TITLE = s("t", fontName="Helvetica-Bold", fontSize=19, leading=22)
SUB = s("s", fontSize=10, leading=14, textColor=MUTED)
H = s("h", fontName="Helvetica-Bold", fontSize=11.5, leading=14,
      textColor=INK, spaceBefore=0, spaceAfter=3)
BODY = s("b", spaceAfter=4)
SMALL = s("sm", fontSize=8.5, leading=11.5, textColor=MUTED)
CELL = s("c", fontSize=8.8, leading=11.8)
CELLB = s("cb", fontSize=8.8, leading=11.8, fontName="Helvetica-Bold")
STEPN = s("stepn", fontName="Helvetica-Bold", fontSize=15, leading=17,
          textColor=ACCENT)


def rule(space_before=5, space_after=5):
    t = Table([[""]], colWidths=[170 * mm], rowHeights=[0.4])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return [Spacer(1, space_before), t, Spacer(1, space_after)]


def step(n, title, lines):
    """A numbered step: big numeral in the gutter, text beside it."""
    inner = [Paragraph(f"<b>{title}</b>", BODY)]
    for ln in lines:
        inner.append(Paragraph(ln, BODY))
    t = Table([[Paragraph(str(n), STEPN), inner]],
              colWidths=[9 * mm, 161 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return KeepTogether([t])


def band(title, rows):
    """A soft-filled callout box with a heading and paragraph rows."""
    inner = [Paragraph(f"<b>{title}</b>", BODY)]
    for r in rows:
        inner.append(Paragraph(r, BODY))
    t = Table([[inner]], colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BAND),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBEFORE", (0, 0), (0, -1), 2, ACCENT),
    ]))
    return t


story = []

# ---------------------------------------------------------------- header ----
story.append(Paragraph("Help us test Ikigaro with your Ultrahuman ring", TITLE))
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Ikigaro reads your blood panels and shows you your own trends over time. "
    "We have just built Ultrahuman syncing, and it has never once run against "
    "a real ring. Yours would be the first. About 10 minutes of setup, then "
    "you wear your ring exactly as you already do.",
    SUB))

story += rule()

# ------------------------------------------------------------ what we get ----
story.append(Paragraph("What we would read, and what we would not", H))
story.append(Paragraph(
    "Only the daily summaries Ultrahuman already computes: <b>sleep duration "
    "and score, HRV, resting heart rate, recovery, steps, blood oxygen, VO2 max "
    "and skin temperature deviation</b>. Plus, if you wear an M1 sensor, your "
    "daily glucose average, variability, time in target and estimated HbA1c.",
    BODY))
story.append(Paragraph(
    "We do not read your minute-by-minute glucose trace, your location, your "
    "workouts or anything else in your account.",
    BODY))
story.append(Paragraph(
    "<b>Your data is shown only to you.</b> It is never sold, never shared with "
    "anyone, and never used for advertising. Disconnect any time from Profile, "
    "which deletes our permission on the spot. We would only ever ask you to "
    "read numbers off your own screen and tell us whether they match.",
    BODY))

story += rule()

# ----------------------------------------------------------------- steps ----
story.append(Paragraph("What to do", H))
story.append(Spacer(1, 3))

story.append(step(1, "Get in", [
    "Sign up at <b>app.ikigaro.com</b> with your email. You will land on a "
    "waiting list, which is normal: it is a closed beta. Tell us you have "
    "signed up and we will approve you within a few minutes.",
]))

story.append(step(2, "Connect the ring", [
    "In the app, go to <b>Profile</b>, then <b>Connected devices</b>, and press "
    "<b>Connect</b> next to Ultrahuman.",
    "Ultrahuman will ask you to approve access for <i>ikigaro</i>, listing "
    "Profile, Ring Data and CGM Data. Press <b>Approve</b>. You come straight "
    "back to Ikigaro.",
]))

story.append(step(3, "Wear it for one full night", [
    "This is the part that cannot be rushed. Almost everything we want to check "
    "is measured while you sleep, so connecting and looking the same afternoon "
    "shows nothing.",
]))

story.append(step(4, "The next morning, compare four numbers", [
    "Open your <b>Ultrahuman app</b> first and look at last night. Then open "
    "Ikigaro, go to <b>Profile &gt; Connected devices</b>, press <b>Sync now</b>, "
    "then go to <b>Trends</b> and find the <b>From your devices</b> card.",
    "Check these four against each other. They should match, and the point of "
    "the exercise is to find out if they do not.",
]))

story.append(Spacer(1, 3))

# ----------------------------------------------------------- check table ----
rows = [
    [Paragraph("In Ikigaro", CELLB),
     Paragraph("Compare against, in the Ultrahuman app", CELLB),
     Paragraph("What a mismatch would mean", CELLB)],
    [Paragraph("<b>Sleep</b>, shown like 7h 05m", CELL),
     Paragraph("Your total sleep for the night", CELL),
     Paragraph("We may be reading their number in the wrong unit", CELL)],
    [Paragraph("<b>HRV</b>", CELL),
     Paragraph("Your <b>overnight</b> HRV, not the all-day figure", CELL),
     Paragraph("There are two HRV numbers and we may have picked the wrong one", CELL)],
    [Paragraph("<b>Steps</b>", CELL),
     Paragraph("Your step count for the same day", CELL),
     Paragraph("We may be reading an average instead of the daily total", CELL)],
    [Paragraph("<b>Sleep score</b>", CELL),
     Paragraph("Your sleep score for the night", CELL),
     Paragraph("Ultrahuman reports two different sleep scores", CELL)],
]
t = Table(rows, colWidths=[42 * mm, 60 * mm, 68 * mm])
t.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LINEBELOW", (0, 0), (-1, 0), 0.7, INK),
    ("LINEBELOW", (0, 1), (-1, -2), 0.3, RULE),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("LEFTPADDING", (0, 0), (0, -1), 0),
]))
story.append(t)
story.append(Spacer(1, 7))
story.append(band("The failure we are actually hunting for", [
    "A number that is wrong but <i>looks</i> perfectly reasonable. If Ikigaro "
    "says 7h 05m and your ring says 7h 05m, that is a pass. If Ikigaro says "
    "7h 05m and your ring says 6h 10m, that is exactly the bug we need, and "
    "nothing about the number would have looked suspicious on its own.",
    "So please compare them side by side rather than judging whether each one "
    "seems plausible.",
]))

story += rule()

# ------------------------------------------------------------ send back ----
story.append(Paragraph("What to send back", H))
story.append(Paragraph(
    "A screenshot of the <b>From your devices</b> card in Ikigaro, and a "
    "screenshot of the same day in your Ultrahuman app. That is the whole "
    "report. If the four numbers match, say so and you are done.",
    BODY))
story.append(Paragraph(
    "Tell us too if something felt broken or confusing, even if it is not on "
    "this list. That is worth as much to us as the numbers.",
    BODY))

story.append(Spacer(1, 5))
story.append(Paragraph("If something does not work", H))
story.append(Paragraph(
    "<b>No Ultrahuman option in Connected devices:</b> your account is probably "
    "still on the waiting list. Tell us and we will approve it.",
    BODY))
story.append(Paragraph(
    "<b>The card says nothing has synced, or shows no numbers:</b> most likely "
    "the ring has not uploaded to Ultrahuman yet. Open the Ultrahuman app "
    "first, let it finish syncing your ring, then press Sync now in Ikigaro "
    "again. If it is still empty after that, tell us: that is a real finding "
    "and worth reporting.",
    BODY))
story.append(Paragraph(
    "<b>No glucose numbers:</b> expected, unless you wear an M1 sensor.",
    BODY))

story.append(Spacer(1, 10))
story.append(Paragraph(
    "Thank you. This is the last untested piece of the integration, and one "
    "night of your ring's data settles it.",
    BODY))
story.append(Spacer(1, 3))
story.append(Paragraph(
    "Questions, or to say you have signed up: reply to whoever sent you this, "
    "or write to team@ikigaro.com.",
    SMALL))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 12 * mm, "Ikigaro, private beta")
    canvas.drawRightString(190 * mm, 12 * mm, f"Page {doc.page}")
    canvas.restoreState()


doc = BaseDocTemplate(OUT, pagesize=A4,
                      leftMargin=20 * mm, rightMargin=20 * mm,
                      topMargin=17 * mm, bottomMargin=18 * mm,
                      title="Ikigaro, Ultrahuman ring tester brief",
                      author="Ikigaro",
                      subject="How to help test Ultrahuman syncing in Ikigaro")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=footer)])
doc.build(story)
print("written", OUT)
