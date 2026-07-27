/**
 * 生き甲斐 ("ikigai") — the motif that sits behind every tonal share backdrop,
 * as vector outlines rather than text.
 *
 * WHY NOT A FONT. The design spec calls for Noto Sans JP and warns that the
 * canvas silently draws tofu if the face has not resolved. Both ways of
 * honouring that are bad here: `next/font/google` offers no Japanese subset
 * for this family (only cyrillic/latin/latin-ext/vietnamese), so it would
 * self-host the entire CJK family — megabytes — for four glyphs; and fetching
 * a subset from Google Fonts at runtime would put a third-party request in
 * front of every card render, which is the one thing this feature was built to
 * avoid.
 *
 * Four fixed glyphs at one fixed tracking are artwork, not text. As outlines
 * they cost 2.4 kB, need no loading, and render identically on every device —
 * the tofu failure mode stops existing rather than being guarded against.
 *
 * PROVENANCE. Noto Sans JP Regular (v56, SIL Open Font License 1.1), from the
 * four-glyph subset Google Fonts serves for
 *   fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400&text=生き甲斐
 * Each glyph is drawn at its own advance plus 0.02em of tracking, per the
 * spec, and y is negated so the path is already in canvas (y-down) space with
 * the alphabetic baseline at y = 0. To regenerate, run that subset through
 * fontTools' SVGPathPen with Transform(1, 0, 0, -1, penX, 0).
 */

/** Design units per em — the path's coordinate space. */
export const MOTIF_UNITS_PER_EM = 1000;

/** Total advance of the four glyphs including inter-glyph tracking, in ems. */
export const MOTIF_ADVANCE_EM = 4.06;

/** SVG path data, canvas y-down, alphabetic baseline at y = 0. */
export const MOTIF_PATH =
  "M209 -646H901V-573H209ZM165 -352H865V-280H165ZM55 -25H949V48H55Z" +
  "M463 -840H541V11H463ZM239 -824 315 -807Q294 -730 264 -656" +
  "Q234 -583 198 -520Q162 -456 121 -408Q114 -415 102 -423Q89 -431 76 -440" +
  "Q64 -448 54 -453Q95 -497 130 -556Q164 -616 192 -684Q220 -752 239 -824Z" +
  "M1199 -685Q1304 -673 1400 -671Q1495 -669 1572 -676Q1633 -682 1694 -694" +
  "Q1754 -707 1808 -724L1819 -652Q1770 -638 1710 -626Q1649 -614 1589 -608" +
  "Q1513 -601 1412 -602Q1312 -602 1204 -612ZM1180 -480" +
  "Q1265 -471 1348 -468Q1431 -466 1505 -469Q1579 -472 1637 -479" +
  "Q1709 -487 1768 -500Q1827 -513 1867 -526L1879 -451Q1838 -440 1783 -430" +
  "Q1728 -419 1665 -411Q1603 -404 1524 -400Q1445 -397 1358 -398" +
  "Q1270 -400 1184 -405ZM1522 -698Q1516 -721 1508 -744" +
  "Q1501 -766 1494 -787L1579 -798Q1584 -756 1595 -710Q1606 -665 1619 -622" +
  "Q1632 -578 1644 -543Q1658 -504 1677 -460Q1696 -416 1719 -373" +
  "Q1742 -330 1768 -291Q1776 -280 1786 -270Q1795 -259 1805 -248L1764 -187" +
  "Q1736 -195 1698 -200Q1660 -206 1620 -210Q1580 -215 1545 -219L1552 -280" +
  "Q1592 -276 1635 -271Q1678 -266 1702 -263Q1660 -328 1628 -397" +
  "Q1597 -466 1575 -527Q1563 -561 1554 -590Q1544 -620 1536 -647" +
  "Q1529 -674 1522 -698ZM1325 -265Q1307 -239 1295 -212" +
  "Q1283 -185 1283 -152Q1283 -90 1340 -59Q1396 -28 1514 -28" +
  "Q1584 -28 1641 -33Q1698 -38 1752 -49L1749 31Q1697 39 1638 44" +
  "Q1579 48 1515 48Q1417 48 1348 28Q1280 8 1244 -33Q1209 -74 1208 -138" +
  "Q1207 -181 1218 -214Q1230 -248 1247 -281ZM2502 -748H2581V80H2502Z" +
  "M2166 -777H2917V-181H2837V-705H2243V-178H2166ZM2204 -539H2873V-467" +
  "H2204ZM2204 -305H2872V-233H2204ZM3114 -310H4007V-244H3114ZM3668 -753" +
  "H3991V-696H3668ZM3668 -632H3964V-575H3668ZM3127 -753H3450V-696H3127Z" +
  "M3158 -634H3449V-577H3158ZM3668 -510H4016V-451H3668ZM3519 -396H3596" +
  "V-280H3519ZM3633 -840H3705V-357H3633ZM3763 -284 3838 -260" +
  "Q3788 -182 3715 -126Q3642 -69 3550 -29Q3458 11 3353 38Q3248 64 3136 81" +
  "Q3133 72 3126 60Q3120 47 3112 34Q3104 21 3098 13Q3208 0 3310 -22" +
  "Q3412 -45 3500 -80Q3587 -115 3654 -166Q3722 -216 3763 -284ZM3415 -840" +
  "H3487V-646Q3487 -597 3479 -550Q3471 -503 3448 -460Q3425 -417 3380 -380" +
  "Q3335 -342 3260 -311Q3255 -320 3246 -330Q3238 -341 3228 -350" +
  "Q3219 -360 3211 -367Q3279 -393 3320 -424Q3360 -456 3381 -492" +
  "Q3402 -528 3408 -567Q3415 -606 3415 -647ZM3104 -492" +
  "Q3168 -497 3256 -506Q3345 -516 3438 -526L3439 -471Q3351 -460 3266 -450" +
  "Q3181 -439 3113 -431ZM3346 -281Q3406 -199 3506 -138Q3607 -78 3738 -40" +
  "Q3869 -1 4017 15Q4009 23 4001 35Q3993 47 3986 59Q3978 71 3973 81" +
  "Q3824 62 3692 19Q3561 -24 3457 -92Q3353 -160 3284 -254Z";
