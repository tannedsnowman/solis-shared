/**
 * Installer fixes for hybrid faults, keyed by the fault's LABEL.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The gospel describes every hybrid fault register — 26 of them, and its
 * `bit_flags` labels match the retired mapper's `faultMessage` strings exactly.
 * What the gospel does NOT carry is the second half of each old entry: a
 * `solution`, written from field experience, telling an installer what to
 * actually go and check.
 *
 * That text is not derivable from any document. It is not in the PDFs the
 * gospel is built from, and no upstream rebuild will regenerate it. Deleting
 * `Hybrid/mapper.tsx` without lifting it out first would have destroyed it,
 * so it lives here instead.
 *
 * KEYED BY LABEL, NOT BY ADDRESS AND BIT
 * --------------------------------------
 * The obvious alternative — `{ 33116: { 0: '...' } }` — ties the advice to a
 * register layout that the map is still correcting. Keying on the label means
 * a fix follows its fault even if the bit moves, and a label the gospel
 * renames simply stops resolving (a missing tip) rather than silently
 * attaching itself to the wrong fault.
 *
 * All 48 entries came from the retired mapper's FAULTCODE1-5 flag tables and
 * its status strings; the file it came from carried 50 `solution` strings, of
 * which two were duplicates of another fault's advice.
 */

/** Fault label -> what to check. */
export const HYBRID_FAULT_SOLUTIONS: Record<string, string> = {
  "No Grid": "Check if any isolators/RCDs have tripped between the consumer unit and the inverter. Check the grid voltage at the AC plug",
  "Grid Over Voltage": "Check the grid voltage at the AC plug for over voltage or loose connections",
  "Grid Under Voltage": "Check the grid voltage at the AC plug for low voltage or check grid standard (advanced settings)",
  "Grid Over Frequency": "Check what grid standard is selected",
  "Grid Under Frequency": "Check what grid standard is selected",
  "Grid Unbalance": "This can be ignored if not permanent",
  "Grid Frequency Fluctuation": "This can be ignored if not permanent",
  "Grid reverse current": "This can be ignored if not permanent",
  "Grid current tracking fault": "This can be ignored if not permanent",
  "MET-COM-FAIL": "Check the meter is powered, then check the communications on both the meter and the inverter",
  "Grid Over Current": "This can be ignored if not permanent",
  "Grid abnormal phase angle": "This can be ignored if not permanent",
  "Backup Overvoltage": "Quickly turn off your solar panels and measure the voltages. Exceeding the input voltage will void warranty",
  "Backup Overload": "If persistent (permanent) inverter is likely not repairable",
  "Grid backup overload": "If persistent (permanent) inverter is likely not repairable",
  "No battery detected": "Measure the voltage on the battery terminals to confirm it is on",
  "Battery overvoltage": "Check the connections between the battery and inverter",
  "Battery undervoltage": "Check the connections between the battery and inverter",
  "Battery BMS Alarm": "Battery Management System has detected a fault and reporting it to inverter",
  "Battery Name Fail": "The battery selected doesnt match the battery which is connected",
  "DC Over Voltage": "Quickly turn off your solar panels and measure the voltages. Exceeding the input voltage will void warranty",
  "DC Bus Over Voltage": "If persistent (permanent) inverter is likely not repairable",
  "DC Bus Unbalance": "If persistent (permanent) inverter is likely not repairable",
  "DC Bus Under Voltage": "If persistent (permanent) inverter is likely not repairable",
  "DC Bus Unbalance 2": "If persistent (permanent) inverter is likely not repairable",
  "DC(Channel A) Over Current": "This can be ignored if not permanent",
  "DC(Channel B) Over Current": "This can be ignored if not permanent",
  "DC interference": "This can be ignored if not permanent. Else it is loose connections on the solar strings",
  "IGBT over current": "If persistent likely to be a damaged inverter",
  "Grid INTF 02": "Loose plug or cabling to AC isolator. Try redo the plug and isolator",
  "AFCI Check Fault": "Arc (loose connection) detected on one of the solar strings",
  "AFCI Fault": "Arc (loose connection) detected on one of the solar strings",
  "Battery over discharge current": "Check the settings, reselect the battery",
  "Temperature Protection": "Check the current temperature measured by inverter. Could be a faulty sensor.",
  "Relay Protection": "If persistent it is likely a faulty grid relay",
  "Ground Insulation Fault": "Try one string at a time. Measure the voltages between PV+ and AC earth, then PV- and earth",
  "12V Under Voltage Faulty ": "Internal DC power supply is damaged. Check COM ports are disconnected",
  "Leakage Current Protection": "Current leak to earth detected. Check parasitic capacitances (parallel earthed conductors to DC cables)",
  "Leakage Current Check Protection": "Current leak to earth detected. Check parasitic capacitances (parallel earthed conductors to DC cables)",
  "CAN-COM Fail": "Check the battery is operating and cable the battery cable",
  "Waiting": "Low power state or checking grid voltages",
  "Grid off ": "The inverter is turned off",
  "FAN fault ": "The inverter detected the fan not operating correctly",
  "AC SPD ERROR": "A voltage surge detected on AC",
  "DC SPD ERROR": "A voltage surge detect on DC",
  "Fan fault": "The inverter detected the fan not operating correctly",
  "Meter COM fail ": "MET_Comm_FAIL",
};

/**
 * The installer fix for a fault label, or null when there is no advice.
 *
 * Matching is exact, then FOLDED — letters and digits only. The gospel and the
 * retired mapper agree on wording but not on capitalisation or punctuation
 * ("Grid reverse current" against "Grid Reverse Current", "Meter COM fail"
 * against "MET-COM-FAIL"), and losing a tip to a hyphen would be a silent
 * regression.
 */
const fold = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]/g, '');

export function solutionFor(label: string): string | null {
  if (!label) return null;
  const exact = HYBRID_FAULT_SOLUTIONS[label];
  if (exact) return exact;
  const wanted = fold(label);
  for (const [key, text] of Object.entries(HYBRID_FAULT_SOLUTIONS)) {
    if (fold(key) === wanted) return text;
  }
  return null;
}
