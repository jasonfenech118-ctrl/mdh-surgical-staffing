/* ============================================================================
 * duty-input-logic.js
 * ----------------------------------------------------------------------------
 * Portable "Duty Card" logic extracted from the MDH Surgical Staffing app
 * (index.html). This is the part that lets you put an EXTRA duty — most often
 * Overtime — on top of a person's rostered day, even when that day is already
 * Leave / Sick / Off, and record WHEN it happens (a From–Till time) so the app
 * can show a ☀️ sun (day) or 🌙 moon (night) icon automatically.
 *
 * It is deliberately framework-free: no DOM, no Supabase, no globals. Every
 * function is pure (except where noted) so you can drop this file into another
 * project and call the bits you need. Adapt the CHOICES arrays and the code
 * aliases to your own project's vocabulary.
 *
 * HOW DATA IS STORED
 *   The primary duty for a day is a single shift code (e.g. "AL" for Leave).
 *   Any EXTRA duties for the same day are appended into a free-text "notes"
 *   field as tokens:
 *       [ALSO:CODE]           extra duty, no time      -> e.g. [ALSO:OT]
 *       [ALSO:CODE@FROM-TO]   extra duty, with hours   -> e.g. [ALSO:OT@19-7]
 *   The primary duty's own time is stored as:
 *       [TIME:FROM-TO]                                 -> e.g. [TIME:7-14]
 *   Storing extras as tokens means you never need a second table: one row per
 *   person per day still holds "on Leave, AND did Overtime 19:00–07:00".
 *
 * A `staff` object is expected to look like:
 *   {
 *     staff_id, full_name, role,            // "charge_nurse" gets night-free rules
 *     roster_pattern_code: "AAOO",          // repeating letters, or null
 *     roster_start_date: "2026-06-01",      // day 0 of the pattern, or null
 *     days: { "2026-06-14": { live_shift_code, override_notes } , ... }
 *   }
 *
 * Exports at the very bottom support both ES modules and CommonJS; in a plain
 * <script> it just defines these as globals.
 * ==========================================================================*/

/* ----------------------------------------------------------------------------
 * 1. SHIFT CODES — normalising, labelling, classifying
 * --------------------------------------------------------------------------*/

// The five raw roster-pattern letters (A=All Day, M=Morning, N=Night, R=Rest, O=Off).
function isPatternCode(code){return /^[AMNRO]$/.test(String(code||"").trim().toUpperCase());}

// Turn any messy input ("annual leave", "TIL-in", "sick") into ONE canonical code.
// This is the single source of truth for what a code "really" is. Extend the
// aliases map for your own project.
function normaliseRosterCode(code){
  const raw=String(code||"").trim().toUpperCase().replace(/\s+/g,"_");
  if(!raw||raw==="—"||raw==="-")return"";
  if(isPatternCode(raw))return raw;
  const aliases={
    AL:"L",ANNUAL:"L",ANNUAL_LEAVE:"L",LEAVE:"L",VL:"L","V/L":"L",VACATION:"L",VACATION_LEAVE:"L",
    S:"SL",SICK:"SL",SICK_LEAVE:"SL",
    MATERNITY:"ML",MATERNITY_LEAVE:"ML",
    STUDY:"ST",STUDY_LEAVE:"ST",
    TIL:"TI",TILIN:"TI",TIL_IN:"TI",TIL_INWARD:"TI",
    TOL:"TO",TILOUT:"TO",TILO:"TO",TIL_OUT:"TO",TIL_OUTWARD:"TO",
    OVERTIME:"OT",
    LONG_LEAVE:"LL",
    CODIN:"CODI",COD_IN:"CODI",COD_ON:"CODI",COD_INWARD:"CODI","COD-IN":"CODI",CODI:"CODI",
    CODOUT:"CODO",COD_OFF:"CODO",COD_OUT:"CODO",COD_OUTWARD:"CODO","COD-OFF":"CODO",CODO:"CODO"
  };
  return aliases[raw]||raw;
}

// What to WRITE to the database. Internally "L" is Leave, but it is stored as "AL".
function storeRosterCode(code){const c=normaliseRosterCode(code);return c==="L"?"AL":c;}

// Short code to SHOW on a badge (a couple of codes read nicer than their canonical form).
function displayShiftCode(code){
  const clean=normaliseRosterCode(code);
  const labels={TI:"TIL",TO:"TOL",CODI:"COD-in",CODO:"COD-off"};
  return labels[clean]||clean||"—";
}

// Full human-readable name for a code.
function shiftLabel(code){
  const labels={A:"All Day",D:"Day",M:"Morning",N:"Night",O:"Off",R:"Rest",
    L:"Leave",AL:"Leave",SL:"Sick Leave",ML:"Maternity",ST:"Study",
    TI:"TIL In",TO:"TIL Out",CODI:"Change of Duty in",CODO:"Change of Duty off",
    OT:"Overtime",LL:"Long Leave",E:"Evening"};
  const clean=normaliseRosterCode(code);
  return labels[clean]||clean||"";
}

// Change-of-duty codes get special handling (they carry a "vice" date).
function isCodCode(code){return ["CODI","CODO"].includes(normaliseRosterCode(code));}

// Why a shift was changed — used for audit reasons when saving.
function reasonForShift(code){
  const clean=normaliseRosterCode(code),map={
    AL:"leave",L:"leave",SL:"sick_leave",ML:"maternity_leave",ST:"study_leave",
    TI:"til_in",TO:"til_out",CODI:"manual_roster_change",CODO:"manual_roster_change",
    OT:"overtime",O:"off",R:"rest",LL:"long_leave",
    A:"manual_day_change",D:"manual_day_change",N:"manual_night_change",
    M:"manual_morning_change",E:"manual_evening_change"};
  return map[clean]||"manual_roster_change";
}

/* ----------------------------------------------------------------------------
 * 2. ☀️ / 🌙  DAY vs NIGHT ICONS
 * --------------------------------------------------------------------------*/

// Codes whose icon is decided by the CORE rostered duty rather than a typed
// time. Sick Leave is the automated one: it shows no From/Till, and its icon
// follows whatever the person was rostered for that day.
const CODES_AUTO_ICON=new Set(["SL"]);

// Icon from a SHIFT CODE: Night -> moon, any day-working code -> sun, else none.
function dutyIcon(code){
  const c=normaliseRosterCode(code);
  if(c==="N")return"🌙";
  if(["A","M","D","E"].includes(c))return"🌞";
  return"";
}

// Icon from an HOUR (0–23): 07:00–18:59 is daytime (sun), everything else is
// night (moon). This is what decides the icon for a typed Overtime time.
function iconForHour(h){return (h>=7&&h<19)?"🌞":"🌙";}

/* ----------------------------------------------------------------------------
 * 3. EXTRA / SECONDARY DUTIES  —  the [ALSO:CODE@FROM-TO] tokens
 *
 * This is the heart of "on Leave in the day but ALSO did Overtime at night".
 * The primary duty stays as-is; extras live inside the notes text as tokens.
 * --------------------------------------------------------------------------*/

// The choices offered for an EXTRA duty in the UI. Note "Overtime (Night)" —
// overtime is most commonly a night, so the label hints at it.
const SECONDARY_SHIFT_CHOICES=[
  {code:"",  label:"— None —"},
  {code:"N", label:"Night"},
  {code:"M", label:"Morning"},
  {code:"A", label:"All Day"},
  {code:"OT",label:"Overtime (Night)"}
];

// Pull the notes text out of a row, whatever the field is called.
function rowNotesText(row){
  if(!row)return"";
  return [row.override_notes,row.notes,row.note].filter(Boolean).join(" ");
}

// The primary duty's own time, if one was recorded: [TIME:7-14] -> "7-14".
function parseTimeToken(notes){const m=String(notes||"").match(/\[TIME:(\d+-\d+)\]/);return m?m[1]:"";}

// Just the CODES of the extra duties on a row (times stripped).
function parseSecondaryCodes(row){
  const text=rowNotesText(row);
  return [...text.matchAll(/\[ALSO:([A-Z0-9]+)(?:@\d+-\d+)?\]/ig)].map(m=>normaliseRosterCode(m[1])).filter(Boolean);
}
function parseSecondaryCode(row){const codes=parseSecondaryCodes(row);return codes[0]||"";}

// The extra duties WITH their times: [{code:"OT", time:"19-7"}, ...].
function parseSecondaryShifts(row){
  const text=rowNotesText(row);
  return [...text.matchAll(/\[ALSO:([A-Z0-9]+)(?:@(\d+)-(\d+))?\]/ig)]
    .map(m=>({code:normaliseRosterCode(m[1]),time:(m[2]!=null&&m[3]!=null)?`${m[2]}-${m[3]}`:""}))
    .filter(s=>s.code);
}

// Remove every [ALSO:...] token from a notes string (keeps the human text).
function stripAllSecondaryTokens(notes){
  return String(notes||"").replace(/\s*\[ALSO:[A-Z0-9]+(?:@\d+-\d+)?\]\s*/ig," ").trim();
}
const stripSecondaryToken=stripAllSecondaryTokens; // alias, back-compat

// Write extras back into a notes string. Pass [{code, time}] objects; time is
// optional and only kept when it looks like "FROM-TO".
function withSecondaryShiftTokens(notes,shifts){
  const base=stripAllSecondaryTokens(notes);
  const toks=(shifts||[]).map(s=>{
    const c=normaliseRosterCode(s.code);
    if(!c)return"";
    const t=(s.time&&/^\d+-\d+$/.test(s.time))?`@${s.time}`:"";
    return `[ALSO:${c}${t}]`;
  }).filter(Boolean);
  return [base,...toks].filter(Boolean).join(" ").trim()||null;
}
// Convenience wrappers when you only have codes (no times).
function withSecondaryTokens(notes,codes){return withSecondaryShiftTokens(notes,(codes||[]).map(c=>({code:c,time:""})));}
function withSecondaryToken(notes,code){return withSecondaryTokens(notes,code?[code]:[]);}

/* ----------------------------------------------------------------------------
 * 4. ROSTER PATTERN  —  what someone is baselined to work on a given day
 *
 * A pattern like "AAOO" repeats from roster_start_date: day0=A, day1=A,
 * day2=O, day3=O, day4=A ... This is the "original duty" the Day Card shows
 * before any override.
 * --------------------------------------------------------------------------*/

function isoFromDate(date){
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,"0"),d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function formatDate(value){if(!value)return"";const[y,m,d]=String(value).split("-");return `${d}/${m}/${y}`;}

// Add (or subtract) whole days from an ISO date string, returning ISO.
function addDaysIso(isoDate,delta){
  const parts=String(isoDate||"").split("-").map(Number);
  if(parts.length!==3||parts.some(n=>!Number.isFinite(n)))return"";
  const d=new Date(parts[0],parts[1]-1,parts[2]);
  d.setDate(d.getDate()+delta);
  return isoFromDate(d);
}

// Which letter of the pattern applies on targetIso, counting from startIso.
function patternShiftForDate(pattern,startIso,targetIso){
  if(!pattern||!startIso||!targetIso)return"";
  const s=new Date(startIso),t=new Date(targetIso);
  s.setHours(0,0,0,0);t.setHours(0,0,0,0);
  const diff=Math.round((t-s)/(864e5));
  if(diff<0)return"";
  return pattern[diff%pattern.length]||"";
}

// The baseline (un-overridden) code for a staff member on a date.
function baselineShiftCode(staff,isoDate,fallbackStart){
  if(!staff||!staff.roster_pattern_code)return"";
  const start=staff.roster_start_date||fallbackStart||isoDate;
  return patternShiftForDate(staff.roster_pattern_code,start,isoDate);
}

/* ----------------------------------------------------------------------------
 * 5. SAFETY RULE  —  rest gap between a Night and a Day
 *
 * A nurse who finishes a night at 07:00 cannot start a day the same morning.
 * shiftSafetyIssue() returns a human-readable warning string, or "" if fine.
 * Overtime (OT) counts as a night for this rule.
 * --------------------------------------------------------------------------*/

function isNightCode(c){const x=normaliseRosterCode(c);return x==="N"||x==="OT";}
function isDayWorkCode(c){return ["A","M","D"].includes(normaliseRosterCode(c));}

// The code actually in force on a date (override wins over the pattern).
function resolvedCodeForDate(staff,iso){
  const live=staff?.days?.[iso]?.live_shift_code||"";
  const pat=baselineShiftCode(staff,iso,iso);
  return normaliseRosterCode(live||pat||"");
}
// Every code in force on a date: the primary plus any extras.
function dayCodesFor(staff,iso){
  const r=staff?.days?.[iso]||null;
  return [resolvedCodeForDate(staff,iso),...parseSecondaryCodes(r)].filter(Boolean);
}

// Given the codes proposed for `iso`, is the night<->day rest rule broken?
function shiftSafetyIssue(staff,iso,codes){
  if(!staff)return"";
  const hasNight=(codes||[]).some(isNightCode),hasDay=(codes||[]).some(isDayWorkCode);
  if(hasNight){
    const next=addDaysIso(iso,1);
    if(next&&dayCodesFor(staff,next).some(isDayWorkCode))
      return `Unsafe rest gap: a night shift here is followed by a day shift on ${formatDate(next)}. A nurse cannot finish a night (07:00) and start a day the same morning.`;
  }
  if(hasDay){
    const prev=addDaysIso(iso,-1);
    if(prev&&dayCodesFor(staff,prev).some(isNightCode))
      return `Unsafe rest gap: a day shift here follows a night shift on ${formatDate(prev)}. There is no rest between the night and this day.`;
  }
  return"";
}

/* ----------------------------------------------------------------------------
 * 6. LONG LEAVE (LL)  —  automatic label for a block of 3+ leave days
 *
 * You never TYPE "LL". Enter Leave (L); if there are 3+ leave days in a row it
 * displays as Long Leave. Off/Rest days DON'T break the block; any real working
 * shift does. computeLongLeaveDisplay works off a map of {isoDate: code}.
 * --------------------------------------------------------------------------*/

function isLongLeaveTrigger(code){return normaliseRosterCode(code)==="L";}
function isLongLeaveGap(code){const c=normaliseRosterCode(code);return c==="O"||c==="R";}

function computeLongLeaveDisplay(resolvedMap,isoDate){
  const code=resolvedMap[isoDate];
  if(code==="LL")return"LL";
  if(!isLongLeaveTrigger(code))return code;
  let leaveCount=1,cursor=addDaysIso(isoDate,-1);
  while(cursor&&(cursor in resolvedMap)){
    const c=resolvedMap[cursor];
    if(isLongLeaveTrigger(c))leaveCount++;
    else if(isLongLeaveGap(c)){/* off/rest: keep scanning */}
    else break;
    cursor=addDaysIso(cursor,-1);
  }
  cursor=addDaysIso(isoDate,1);
  while(cursor&&(cursor in resolvedMap)){
    const c=resolvedMap[cursor];
    if(isLongLeaveTrigger(c))leaveCount++;
    else if(isLongLeaveGap(c)){/* off/rest: keep scanning */}
    else break;
    cursor=addDaysIso(cursor,1);
  }
  return leaveCount>=3?"LL":code;
}

/* ----------------------------------------------------------------------------
 * 7. DAY CARD RULES  —  which duty codes may be picked, and when
 *
 * SHIFT_PICKER_CHOICES is the full menu. Some codes make no sense depending on
 * the day's ORIGINAL rostered duty, so allowedDutyOptions() filters them out.
 *   - CODI/CODO/ML and the raw pattern letters are hidden from this "add extra"
 *     menu by default (DAY_CARD_HIDDEN_CODES).
 *   - The day's own original code is hidden (no point re-selecting it).
 *   - TIL In is hidden when the core duty is All Day or Night.
 *   - Sick / TIL Out / Leave / Study are hidden when the core duty is Off/Rest
 *     (you can't be "on leave" from a day you weren't working).
 * A code is always kept if it is the one currently selected, so existing
 * entries still display.
 * --------------------------------------------------------------------------*/

const SHIFT_PICKER_CHOICES=[
  {code:"A",label:"All Day"},{code:"M",label:"Morning"},{code:"N",label:"Night"},
  {code:"O",label:"Off"},{code:"R",label:"Rest"},
  {code:"L",label:"Leave"},{code:"SL",label:"Sick Leave"},{code:"ML",label:"Maternity"},{code:"ST",label:"Study"},
  {code:"TI",label:"TIL In"},{code:"TO",label:"TIL Out"},
  {code:"CODI",label:"COD-in"},{code:"CODO",label:"COD-off"},
  {code:"OT",label:"Overtime"}
];

const DAY_CARD_HIDDEN_CODES=new Set(["CODO","CODI","ML","A","M","N","O","R"]);

// Returns the filtered list of {code,label} the user may choose from.
//   originalCode  – the day's rostered duty (drives the context rules)
//   selectedCode  – the currently-chosen code (always kept visible)
function allowedDutyOptions(originalCode="",selectedCode=""){
  const origNorm=normaliseRosterCode(originalCode||"");
  // When there's no rostered duty at all, the cell reads as "Off" for filtering.
  const filterNorm=origNorm||"O";
  const hidden=new Set([...DAY_CARD_HIDDEN_CODES,origNorm]);
  if(filterNorm==="A"||filterNorm==="N")hidden.add("TI");
  if(filterNorm==="O"||filterNorm==="R"){hidden.add("SL");hidden.add("TO");hidden.add("L");hidden.add("ST");}
  return SHIFT_PICKER_CHOICES.filter(c=>!hidden.has(c.code)||c.code===selectedCode);
}

/* ----------------------------------------------------------------------------
 * 8. VALIDATION + SAVE SHAPE  —  turn Day Card entries into a row to store
 *
 * Feed buildDutySave() the list of entries the user filled in. Entry 0 is the
 * PRIMARY duty for the day; entries 1+ are EXTRAS (overtime, a night, etc).
 * Each entry: { code, time:"FROM-TO"|"", codDate:"YYYY-MM-DD"|"" }.
 *
 * Returns either { error:"..." } or a ready-to-store object:
 *   { shiftCode, reason, notes }
 * where notes already carries the [ALSO:...] and [TIME:...] tokens.
 *
 * Pass `staff` and `shiftDate` to also enforce the night/day rest rule.
 * --------------------------------------------------------------------------*/

function buildDutySave(entries,{staff=null,shiftDate=null}={}){
  const list=entries||[];
  const mainEntry=list[0]||{};
  const mainCode=normaliseRosterCode(mainEntry.code||"");
  const allowed=new Set(SHIFT_PICKER_CHOICES.map(x=>x.code));

  if(!mainCode)return{error:"Please choose a day shift from the first row."};
  if(mainCode==="LL")return{error:"Long Leave is automatic. Select Leave and the system shows LL after 3 consecutive days."};
  if(!allowed.has(mainCode))return{error:"Select a valid shift for the day row."};
  if(isCodCode(mainCode)&&!mainEntry.codDate)return{error:"Choose the vice date for COD-in/COD-off (first row)."};

  const extraCodes=[],extraShifts=[];
  for(let i=1;i<list.length;i++){
    const ent=list[i]||{};
    const ec=normaliseRosterCode(ent.code||"");
    if(!ec)continue;
    if(!allowed.has(ec))return{error:`Entry ${i+1}: choose a valid shift code.`};
    if(isCodCode(ec))return{error:`Entry ${i+1}: COD-in/COD-off can only be set on the first (day) row.`};
    extraCodes.push(ec);
    let et="";
    if(ent.time&&!CODES_AUTO_ICON.has(ec)){const[tf,tt]=ent.time.split("-");if(tf!==""&&tt!=="")et=`${tf}-${tt}`;}
    extraShifts.push({code:ec,time:et});
  }

  // Rest-gap safety (only checked when we have the staff + date context).
  if(staff&&shiftDate){
    const issue=shiftSafetyIssue(staff,shiftDate,[mainCode,...extraCodes]);
    if(issue)return{error:issue};
  }

  let notes=null;
  if(isCodCode(mainCode)&&mainEntry.codDate)notes=`vice ${mainEntry.codDate}`;
  notes=withSecondaryShiftTokens(notes,extraShifts);
  if(mainEntry.time&&!CODES_AUTO_ICON.has(mainCode)){
    const[tf,tt]=mainEntry.time.split("-");
    if(tf!==""&&tt!=="")notes=(notes?notes+" ":"")+`[TIME:${tf}-${tt}]`;
  }

  const shiftCode=storeRosterCode(mainCode);
  return{shiftCode,reason:reasonForShift(shiftCode),notes};
}

/* ----------------------------------------------------------------------------
 * EXPORTS  —  works as an ES module, a CommonJS module, or plain <script>.
 * --------------------------------------------------------------------------*/
const DutyInputLogic={
  // codes
  isPatternCode,normaliseRosterCode,storeRosterCode,displayShiftCode,shiftLabel,isCodCode,reasonForShift,
  // icons
  CODES_AUTO_ICON,dutyIcon,iconForHour,
  // extra-duty tokens
  SECONDARY_SHIFT_CHOICES,rowNotesText,parseTimeToken,parseSecondaryCodes,parseSecondaryCode,
  parseSecondaryShifts,stripAllSecondaryTokens,stripSecondaryToken,
  withSecondaryShiftTokens,withSecondaryTokens,withSecondaryToken,
  // patterns / dates
  isoFromDate,formatDate,addDaysIso,patternShiftForDate,baselineShiftCode,
  // safety
  isNightCode,isDayWorkCode,resolvedCodeForDate,dayCodesFor,shiftSafetyIssue,
  // long leave
  isLongLeaveTrigger,isLongLeaveGap,computeLongLeaveDisplay,
  // day-card rules + save
  SHIFT_PICKER_CHOICES,DAY_CARD_HIDDEN_CODES,allowedDutyOptions,buildDutySave
};

if(typeof module!=="undefined"&&module.exports){module.exports=DutyInputLogic;}
if(typeof window!=="undefined"){Object.assign(window,DutyInputLogic);window.DutyInputLogic=DutyInputLogic;}
