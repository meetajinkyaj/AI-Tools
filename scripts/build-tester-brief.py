"""Builds the wearable tester briefing PDF.

A two-page handout for somebody who owns an Oura ring, an Ultrahuman ring or a
Whoop band and might help us test the sync. Written for THEM, not for us: no
SQL, no admin console, and nothing they cannot check on their own two screens.

    pip install reportlab
    python3 scripts/build-tester-brief.py

Output: docs/outreach/Ikigaro-wearable-tester-brief.pdf

WHY THESE CHECKS ARE THESE CHECKS. Every one is a mapping decision made from a
vendor's documented example rather than from real data, and every one has a
plausible wrong answer. Four adapters have been audited against vendor docs and
all four were wrong: sleep arriving in seconds and read as minutes, steps under
`total` and read from `avg`, two HRV fields with only one meaning overnight, a
nap silently replacing a whole night, blood oxygen read from a collection that
does not carry it. A tester comparing a handful of numbers against their own
app is the cheapest way to find the ones still hiding. See docs/WEARABLES.md.

ONE DOCUMENT FOR THREE DEVICES on purpose. The instructions are identical apart
from a per-device table, and three near-identical PDFs is how two of them go
stale.
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

OUT = "docs/outreach/Ikigaro-wearable-tester-brief.pdf"

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
story.append(Paragraph("Help us test Ikigaro with your ring or band", TITLE))
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Ikigaro reads your blood panels and shows you your own trends over time. "
    "We have just built device syncing for <b>Oura</b>, <b>Ultrahuman</b> and "
    "<b>Whoop</b>, and it has never run against a real device. Yours would be "
    "among the first. About 10 minutes of setup, then you wear your device "
    "exactly as you already do.",
    SUB))

story += rule()

# ------------------------------------------------------------ what we get ----
story.append(Paragraph("What we would read, and what we would not", H))
story.append(Paragraph(
    "Only the daily summaries your device already computes: <b>sleep duration "
    "and score, HRV, resting heart rate, recovery or readiness, steps and "
    "blood oxygen</b>. On an Ultrahuman with an M1 sensor, also your daily "
    "glucose average, variability and time in target.",
    BODY))
story.append(Paragraph(
    "We do not read your workouts, your location, your minute-by-minute heart "
    "rate or glucose traces, or anything else in your account.",
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

story.append(step(2, "Connect your device", [
    "In the app, go to <b>Profile</b>, then <b>Connected devices</b>, and press "
    "<b>Connect</b> next to your device. Only devices we have finished setting "
    "up appear there, so if yours is missing, tell us.",
    "Your device's own site will ask you to approve access for <i>Ikigaro</i> "
    "and list what it is granting. Press <b>Approve</b>. You come straight back "
    "to Ikigaro.",
    "<b>Whoop only:</b> this needs an active Whoop membership, not just an "
    "account. If sign-in bounces you back without an approval screen, that is "
    "the reason, and it is nothing you did wrong.",
]))

story.append(step(3, "Wear it for one full night", [
    "This is the part that cannot be rushed. Almost everything we want to check "
    "is measured while you sleep, so connecting and looking the same afternoon "
    "shows nothing.",
]))

story.append(step(4, "The next morning, compare the numbers", [
    "Open <b>your device's own app</b> first and look at last night. Then open "
    "Ikigaro, go to <b>Profile &gt; Connected devices</b>, press <b>Sync now</b>, "
    "then go to <b>Trends</b> and find the <b>From your devices</b> card.",
    "Check these against each other. They should match, and the point of the "
    "exercise is to find out where they do not.",
]))

story.append(Spacer(1, 3))

# ----------------------------------------------------------- check table ----
rows = [
    [Paragraph("In Ikigaro", CELLB),
     Paragraph("Compare against, in your device's app", CELLB),
     Paragraph("What a mismatch would mean", CELLB)],
    [Paragraph("<b>Sleep</b>, shown like 7h 05m", CELL),
     Paragraph("Your total sleep for the night, <b>not</b> your time in bed", CELL),
     Paragraph("We may be reading their number in the wrong unit, or counting time you were awake", CELL)],
    [Paragraph("<b>HRV</b>", CELL),
     Paragraph("Your <b>overnight</b> HRV, not an all-day figure", CELL),
     Paragraph("Most devices report two, and we may have picked the wrong one", CELL)],
    [Paragraph("<b>Readiness</b>", CELL),
     Paragraph("Oura: Readiness. Ultrahuman: Recovery. Whoop: Recovery", CELL),
     Paragraph("These are one number to us, so a mismatch means we read the wrong field", CELL)],
    [Paragraph("<b>Steps</b>", CELL),
     Paragraph("Your step count for the same day. <b>Whoop does not count steps</b>, so it should be missing there", CELL),
     Paragraph("We may be reading an average instead of a daily total", CELL)],
    [Paragraph("<b>Sleep score</b>", CELL),
     Paragraph("Your sleep score. On Whoop, Sleep Performance", CELL),
     Paragraph("Some devices report two different sleep scores", CELL)],
    [Paragraph("<b>Blood oxygen</b>", CELL),
     Paragraph("Your overnight average SpO2, if your device measures it", CELL),
     Paragraph("This one was silently missing on Oura until recently", CELL)],
]
# repeatRows keeps the header on page two, where this table splits.
t = Table(rows, colWidths=[42 * mm, 60 * mm, 68 * mm], repeatRows=1)
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
    "says 7h 05m and your device says 7h 05m, that is a pass. If Ikigaro says "
    "7h 05m and your device says 6h 10m, that is exactly the bug we need, and "
    "nothing about the number would have looked suspicious on its own.",
    "So please compare them side by side rather than judging whether each one "
    "seems plausible.",
    "<b>If you nap, that is a gift.</b> Naps are logged separately from the "
    "night, and on two of these devices we found that an afternoon nap could "
    "quietly replace the whole night's sleep. A day where you napped is the "
    "single most useful day you can send us.",
]))

story += rule()

# ------------------------------------------------------------ send back ----
story.append(Paragraph("What to send back", H))
story.append(Paragraph(
    "A screenshot of the <b>From your devices</b> card in Ikigaro, and a "
    "screenshot of the same day in your device's own app. That is the whole "
    "report. If the numbers match, say so and you are done.",
    BODY))
story.append(Paragraph(
    "Tell us too if something felt broken or confusing, even if it is not on "
    "this list. That is worth as much to us as the numbers.",
    BODY))

story.append(Spacer(1, 5))
story.append(Paragraph("If something does not work", H))
story.append(Paragraph(
    "<b>Your device is not listed in Connected devices:</b> either your account "
    "is still on the waiting list, or we have not finished setting that device "
    "up. Either way, tell us.",
    BODY))
story.append(Paragraph(
    "<b>Whoop bounces you back after sign-in, with no approval screen:</b> "
    "Whoop only allows this for accounts with an active membership. Nothing "
    "you did wrong, and nothing we can fix from our side.",
    BODY))
story.append(Paragraph(
    "<b>The card says nothing has synced, or shows no numbers:</b> most likely "
    "your device has not uploaded to its own cloud yet. Open its app first, "
    "let it finish syncing, then press Sync now in Ikigaro again. If it is "
    "still empty after that, tell us: that is a real finding and worth "
    "reporting.",
    BODY))
story.append(Paragraph(
    "<b>Some numbers are missing:</b> often correct. Whoop does not count "
    "steps, not every device measures blood oxygen, and glucose only appears "
    "on an Ultrahuman with an M1 sensor. Tell us which are missing anyway, "
    "since that is exactly the kind of gap we are looking for.",
    BODY))

story.append(Spacer(1, 10))
story.append(Paragraph(
    "Thank you. This is the last untested piece of the integration, and one "
    "night of your device's data settles it.",
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
