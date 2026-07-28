/**
 * The five Iki rank kanji — 芽 修 錬 師 道 — as vector outlines.
 *
 * WHY NOT A FONT. The Iki Badges v3 spec says to await
 * `document.fonts.load('400 26px "Noto Sans JP"')` before painting, because
 * the canvas silently draws tofu if the face has not resolved. That guard is
 * unfollowable here for the same reason it was for the 生き甲斐 motif:
 * `next/font/google` serves no Japanese subset for this family (only
 * cyrillic/latin/latin-ext/vietnamese), so honouring it means either
 * self-hosting the whole CJK family — megabytes for five glyphs — or a
 * third-party request in front of every badge paint, which is precisely what
 * the share pipeline exists to avoid.
 *
 * Five fixed glyphs are artwork, not text. As outlines they need no loading,
 * render identically everywhere, and delete the tofu failure mode rather than
 * defending against it. Same decision, same provenance, as `ikigai-motif.ts`.
 *
 * PROVENANCE. Noto Sans JP Regular (v56, SIL Open Font License 1.1), from the
 * five-glyph subset Google Fonts serves for
 *   fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400&text=芽修錬師道
 * y is negated so the path is already in canvas (y-down) space with the
 * alphabetic baseline at y = 0. To regenerate, run that subset through
 * fontTools' SVGPathPen with Transform(1, 0, 0, -1, 0, 0).
 */

import type { RankId } from "./iki-rank";

/** Design units per em — the paths' coordinate space. */
export const KANJI_UNITS_PER_EM = 1000;

/** Every glyph in this subset is full-width: one em advance. */
export const KANJI_ADVANCE = 1000;

/**
 * Outline per rank, canvas y-down, alphabetic baseline at y = 0.
 *
 * To place at font-size S with the glyph centred on (cx, cy), scale by
 * S / KANJI_UNITS_PER_EM and translate by (cx - S/2, cy + S*0.36) — 0.36em
 * being roughly half the cap height of these ideographs, which is what makes
 * a kanji look optically centred rather than sitting low.
 */
export const RANK_KANJI_PATH: Record<RankId, string> = {
  // 芽
  rookie:
    "M59 -323H944V-253H59ZM271 -524H345V-292H271ZM123 -560H894V-491H123Z" +
    "M588 -310 646 -268Q600 -220 536.5 -173.5Q473 -127 398.5 -85.5" +
    "Q324 -44 246.0 -10.5Q168 23 93 44Q86 29 73.0 10.0Q60 -9 46 -22" +
    "Q121 -39 199.0 -69.5Q277 -100 350.5 -138.5Q424 -177 485.5 -221.0" +
    "Q547 -265 588 -310ZM638 -523H713V-13Q713 23 702.0 41.5Q691 60 664 69" +
    "Q635 77 587.5 79.0Q540 81 470 81Q467 65 459.0 44.5Q451 24 441 8" +
    "Q480 9 515.0 9.5Q550 10 575.5 10.0Q601 10 612 9Q627 8 632.5 3.5Q638 -1 638 -14" +
    "ZM62 -758H941V-690H62ZM287 -840H361V-593H287ZM635 -840H709V-593H635Z",
  // 修
  apprentice:
    "M698 -386 755 -362Q725 -331 682.5 -303.0Q640 -275 592.0 -253.0" +
    "Q544 -231 496 -215Q489 -226 476.5 -238.5Q464 -251 454 -260" +
    "Q499 -274 545.0 -293.0Q591 -312 631.0 -336.0Q671 -360 698 -386Z" +
    "M794 -289 850 -266Q812 -224 757.5 -189.5Q703 -155 638.5 -128.5" +
    "Q574 -102 506 -83Q500 -94 489.0 -108.5Q478 -123 467 -133Q531 -148 593.0 -170.5" +
    "Q655 -193 707.5 -223.5Q760 -254 794 -289ZM887 -180 952 -152" +
    "Q903 -93 826.0 -48.5Q749 -4 653.5 26.5Q558 57 452 76Q446 63 435.0 45.0" +
    "Q424 27 413 15Q514 0 605.0 -26.0Q696 -52 769.5 -90.5Q843 -129 887 -180Z" +
    "M565 -841 634 -823Q598 -734 543.0 -653.5Q488 -573 428 -518" +
    "Q422 -524 411.5 -532.5Q401 -541 390.0 -549.5Q379 -558 370 -562" +
    "Q431 -613 482.5 -686.5Q534 -760 565 -841ZM543 -731H950V-668H505Z" +
    "M813 -717 884 -701Q843 -606 774.5 -536.5Q706 -467 616.5 -419.0" +
    "Q527 -371 423 -338Q419 -347 411.0 -358.0Q403 -369 394.0 -380.0" +
    "Q385 -391 379 -398Q480 -424 565.5 -466.5Q651 -509 714.5 -571.0" +
    "Q778 -633 813 -717ZM536 -692Q567 -632 626.5 -575.0Q686 -518 775.5 -474.0" +
    "Q865 -430 982 -408Q975 -401 967.0 -390.0Q959 -379 952.0 -368.0" +
    "Q945 -357 940 -347Q823 -374 734.0 -423.0Q645 -472 584.0 -532.5" +
    "Q523 -593 489 -655ZM310 -721H377V-86H310ZM233 -834 302 -815" +
    "Q274 -728 235.5 -643.0Q197 -558 151.5 -483.0Q106 -408 57 -349" +
    "Q54 -358 47.0 -372.5Q40 -387 32.0 -401.5Q24 -416 18 -426Q61 -476 101.5 -541.5" +
    "Q142 -607 175.5 -682.0Q209 -757 233 -834ZM153 -590 222 -659 224 -657V80H153Z",
  // 錬
  pro:
    "M425 -736H951V-669H425ZM514 -388V-303H862V-388ZM514 -527V-443H862V-527Z" +
    "M449 -585H929V-245H449ZM650 -840H720V79H650ZM622 -278 680 -259" +
    "Q652 -196 610.0 -137.0Q568 -78 518.5 -29.5Q469 19 417 50Q411 41 402.0 30.5" +
    "Q393 20 384.0 10.0Q375 0 367 -7Q418 -33 466.5 -75.5Q515 -118 556.0 -170.5" +
    "Q597 -223 622 -278ZM748 -277Q773 -226 810.0 -174.0Q847 -122 890.0 -78.0" +
    "Q933 -34 974 -6Q962 4 947.0 20.0Q932 36 922 50Q881 17 838.0 -33.0" +
    "Q795 -83 757.5 -141.0Q720 -199 694 -257ZM108 -594H393V-530H108ZM55 -421H421" +
    "V-355H55ZM77 -290 129 -302Q145 -257 156.0 -204.0Q167 -151 170 -113L114 -99" +
    "Q113 -138 102.5 -191.0Q92 -244 77 -290ZM45 -20Q94 -29 156.5 -41.0" +
    "Q219 -53 289.0 -66.5Q359 -80 429 -95L434 -32Q336 -10 237.5 11.5Q139 33 61 49Z" +
    "M355 -311 414 -296Q401 -250 388.0 -200.5Q375 -151 362 -116L313 -131" +
    "Q321 -155 329.0 -187.5Q337 -220 344.0 -252.5Q351 -285 355 -311ZM211 -568H278" +
    "V-23L211 -13ZM208 -840H248V-824H270V-804Q241 -747 191.0 -673.5" +
    "Q141 -600 67 -534Q61 -542 53.0 -551.0Q45 -560 36.0 -568.5Q27 -577 20 -582" +
    "Q66 -620 102.0 -664.5Q138 -709 164.5 -754.5Q191 -800 208 -840ZM220 -840H276" +
    "Q306 -814 338.5 -782.0Q371 -750 400.5 -719.0Q430 -688 448 -662L397 -605" +
    "Q380 -630 353.0 -663.0Q326 -696 295.5 -729.0Q265 -762 235 -787H220Z",
  // 師
  sensei:
    "M110 -690H382V-412H110V-477H314V-625H110ZM112 -319H391V-18H112V-83H323V-254" +
    "H112ZM80 -690H148V50H80ZM421 -788H956V-719H421ZM207 -841 289 -829" +
    "Q273 -785 254.0 -737.5Q235 -690 217 -656L157 -670Q166 -694 176.0 -724.0" +
    "Q186 -754 194.5 -785.0Q203 -816 207 -841ZM651 -758H722V79H651ZM459 -595H891" +
    "V-527H528V-70H459ZM856 -595H926V-150Q926 -124 920.0 -108.0Q914 -92 896 -84" +
    "Q879 -75 852.0 -73.0Q825 -71 785 -71Q783 -86 776.5 -104.5Q770 -123 763 -137" +
    "Q791 -136 813.0 -136.0Q835 -136 841 -137Q850 -137 853.0 -140.0" +
    "Q856 -143 856 -151Z",
  // 道
  grandmaster:
    "M311 -713H947V-650H311ZM584 -685 669 -677Q657 -639 643.5 -601.0" +
    "Q630 -563 618 -535L556 -548Q564 -577 572.5 -616.5Q581 -656 584 -685Z" +
    "M758 -840 835 -822Q814 -787 792.0 -752.5Q770 -718 750 -693L688 -710" +
    "Q700 -729 713.0 -752.0Q726 -775 738.5 -798.5Q751 -822 758 -840Z" +
    "M417 -815 476 -838Q500 -813 521.0 -781.0Q542 -749 550 -725L488 -698" +
    "Q480 -722 460.0 -755.5Q440 -789 417 -815ZM262 -445V-91H189V-375H49V-445Z" +
    "M262 -124Q298 -69 362.0 -42.0Q426 -15 513 -12Q554 -10 612.5 -9.5" +
    "Q671 -9 735.5 -10.0Q800 -11 860.0 -13.0Q920 -15 965 -18Q960 -10 955.0 4.0" +
    "Q950 18 946.0 32.5Q942 47 940 58Q899 60 843.0 61.0Q787 62 727.0 62.5" +
    "Q667 63 610.5 62.5Q554 62 513 61Q415 57 345.5 29.0Q276 1 228 -59" +
    "Q192 -27 154.0 5.5Q116 38 75 72L36 -5Q72 -29 113.5 -60.5Q155 -92 194 -124Z" +
    "M60 -771 115 -816Q148 -795 182.0 -767.5Q216 -740 244.5 -712.0" +
    "Q273 -684 291 -660L231 -610Q216 -634 187.5 -663.0Q159 -692 125.5 -720.5" +
    "Q92 -749 60 -771ZM462 -375V-292H795V-375ZM462 -237V-153H795V-237ZM462 -512" +
    "V-430H795V-512ZM391 -570H869V-94H391Z",
};

/** The literal character, for alt text and aria labels. */
export const RANK_KANJI_CHAR: Record<RankId, string> = {
  rookie: "芽",
  apprentice: "修",
  pro: "錬",
  sensei: "師",
  grandmaster: "道",
};

/**
 * 生き甲斐 as FOUR SEPARATE outlines, for setting on a curve.
 *
 * `ikigai-motif.ts` already carries these glyphs, but as one concatenated
 * path on a straight baseline — right for the share backdrop, useless for the
 * pin, where each glyph needs its own position AND its own rotation around the
 * ring. Splitting them is the only way to set the phrase on an arc.
 *
 * WHY NOT <text> ON A textPath. That was the first cut, and it was wrong: the
 * ring is Marcellus, whose only subsets are latin and latin-ext. It has no CJK
 * at all, so the phrase rendered purely on whatever Japanese face the device
 * happened to have installed — correct on a Mac, tofu on a Windows machine
 * without the JP language pack. A badge people post publicly is the last place
 * to leave that to chance.
 *
 * Same provenance as the rank kanji: Noto Sans JP Regular (v56, SIL OFL 1.1),
 * y negated into canvas space, alphabetic baseline at y = 0.
 */
export const IKIGAI_GLYPHS: readonly { char: string; path: string }[] = [
  {
    char: "生",
    path:
      "M209 -646H901V-573H209ZM165 -352H865V-280H165ZM55 -25H949V48H55ZM463 -840H541" +
      "V11H463ZM239 -824 315 -807Q294 -730 264.0 -656.5Q234 -583 198.0 -519.5" +
      "Q162 -456 121 -408Q114 -415 101.5 -423.0Q89 -431 76.5 -439.5Q64 -448 54 -453" +
      "Q95 -497 129.5 -556.5Q164 -616 192.0 -684.0Q220 -752 239 -824Z",
  },
  {
    char: "き",
    path:
      "M179 -685Q284 -673 379.5 -671.0Q475 -669 552 -676Q613 -682 673.5 -694.5" +
      "Q734 -707 788 -724L799 -652Q750 -638 689.5 -626.0Q629 -614 569 -608" +
      "Q493 -601 392.5 -601.5Q292 -602 184 -612ZM160 -480Q245 -471 328.0 -468.5" +
      "Q411 -466 485.0 -469.0Q559 -472 617 -479Q689 -487 748.0 -500.0" +
      "Q807 -513 847 -526L859 -451Q818 -440 763.0 -429.5Q708 -419 645 -411" +
      "Q583 -404 504.0 -400.5Q425 -397 337.5 -398.5Q250 -400 164 -405ZM502 -698" +
      "Q496 -721 488.5 -743.5Q481 -766 474 -787L559 -798Q564 -756 575.0 -710.5" +
      "Q586 -665 599.0 -621.5Q612 -578 624 -543Q638 -504 657.0 -460.0" +
      "Q676 -416 699.0 -373.0Q722 -330 748 -291Q756 -280 765.5 -269.5" +
      "Q775 -259 785 -248L744 -187Q716 -195 678.0 -200.5Q640 -206 600.0 -210.5" +
      "Q560 -215 525 -219L532 -280Q572 -276 615.0 -271.0Q658 -266 682 -263" +
      "Q640 -328 608.5 -397.0Q577 -466 555 -527Q543 -561 533.5 -590.5" +
      "Q524 -620 516.5 -647.0Q509 -674 502 -698ZM305 -265Q287 -239 275.0 -212.0" +
      "Q263 -185 263 -152Q263 -90 319.5 -59.0Q376 -28 494 -28Q564 -28 621.0 -33.0" +
      "Q678 -38 732 -49L729 31Q677 39 618.0 43.5Q559 48 495 48Q397 48 328.5 28.0" +
      "Q260 8 224.5 -33.0Q189 -74 188 -138Q187 -181 198.5 -214.5Q210 -248 227 -281Z",
  },
  {
    char: "甲",
    path:
      "M462 -748H541V80H462ZM126 -777H877V-181H797V-705H203V-178H126ZM164 -539H833" +
      "V-467H164ZM164 -305H832V-233H164Z",
  },
  {
    char: "斐",
    path:
      "M54 -310H947V-244H54ZM608 -753H931V-696H608ZM608 -632H904V-575H608ZM67 -753" +
      "H390V-696H67ZM98 -634H389V-577H98ZM608 -510H956V-451H608ZM459 -396H536V-280" +
      "H459ZM573 -840H645V-357H573ZM703 -284 778 -260Q728 -182 655.0 -125.5" +
      "Q582 -69 490.0 -29.0Q398 11 293.0 37.5Q188 64 76 81Q73 72 66.5 59.5" +
      "Q60 47 52.0 34.0Q44 21 38 13Q148 0 250.0 -22.5Q352 -45 439.5 -80.0" +
      "Q527 -115 594.5 -165.5Q662 -216 703 -284ZM355 -840H427V-646" +
      "Q427 -597 419.0 -550.0Q411 -503 388.0 -460.0Q365 -417 320.0 -379.5" +
      "Q275 -342 200 -311Q195 -320 186.5 -330.5Q178 -341 168.5 -350.5" +
      "Q159 -360 151 -367Q219 -393 259.5 -424.5Q300 -456 321.0 -492.0" +
      "Q342 -528 348.5 -567.0Q355 -606 355 -647ZM44 -492Q108 -497 196.5 -506.5" +
      "Q285 -516 378 -526L379 -471Q291 -460 206.0 -449.5Q121 -439 53 -431ZM286 -281" +
      "Q346 -199 446.5 -138.5Q547 -78 678.0 -39.5Q809 -1 957 15Q949 23 941.0 35.0" +
      "Q933 47 925.5 59.0Q918 71 913 81Q764 62 632.5 19.0Q501 -24 397.0 -92.0" +
      "Q293 -160 224 -254Z",
  },
];
