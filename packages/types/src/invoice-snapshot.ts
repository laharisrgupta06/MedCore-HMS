import {
  formatPaise,
  lineTax,
  roomTreatment,
  taxCollection,
  toPaise,
  type CriticalCareUnit,
  type GstRegistrationType,
  type TaxNotCollectedReason,
  type TaxSupplyType,
  type TaxTreatment,
} from './billing';

/**
 * The tax snapshot of one invoice line (DEC-051), computed exactly as the M-11b line trigger
 * recomputes it: the classification's version in force on the service date, the GST registration in
 * force on the service date (DEC-047), and the statutory room rule for room lines (DEC-049). The API
 * stores what this returns; the database refuses anything else. Pure: callers load the data under
 * the DEC-058 locks (hospital row FOR SHARE, then classification row) and pass it in.
 */
export type InvoiceLineKind = 'CONSULTATION' | 'LAB' | 'PHARMACY' | 'ROOM' | 'OTHER';

export interface VersionData {
  id: string;
  effectiveFrom: string;
  treatment: TaxTreatment;
  ratePercent: string;
  priceIncludesTax: boolean;
}
export interface ClassificationData {
  id: string;
  name: string;
  hsnSac: string;
  supplyType: TaxSupplyType;
  isActive: boolean;
  versions: readonly VersionData[];
}
export interface RegistrationData {
  effectiveFrom: string;
  registrationType: GstRegistrationType;
}
export interface RoomRuleData {
  id: string;
  effectiveFrom: string;
  thresholdPerDay: string;
  ratePercent: string;
  sacCode: string;
  priceIncludesTax: boolean;
}
export interface RoomData {
  dailyCharge: string | null;
  type: string;
  criticalCareUnit: CriticalCareUnit | null;
}

export interface LineSnapshotInput {
  kind: InvoiceLineKind;
  quantity: number;
  unitPrice: string;
  serviceDate: string;
  discountShare?: string;
  /** The classification the line must use (null: none assigned). Not used for ROOM. */
  classification: ClassificationData | null;
  registrations: readonly RegistrationData[];
  room?: RoomData;
  roomRules?: readonly RoomRuleData[];
}

export interface LineSnapshot {
  unclassified: boolean;
  classificationId: string | null;
  classificationVersionId: string | null;
  classificationName: string | null;
  hsnSac: string | null;
  supplyType: TaxSupplyType | null;
  treatment: TaxTreatment | null;
  ratePercent: string | null;
  priceIncludesTax: boolean | null;
  gstCollected: boolean;
  notCollectedReason: TaxNotCollectedReason | null;
  roomRuleId: string | null;
  roomDailyCharge: string | null;
  roomCriticalCare: boolean | null;
  grossAmount: string;
  discountShare: string;
  taxableValue: string;
  taxAmount: string;
  lineTotal: string;
}

export const ROOM_LINE_NAME = 'Room accommodation';

export class LineSnapshotError extends Error {
  constructor(
    readonly code: 'CLASSIFICATION_UNUSABLE' | 'ROOM_NO_CHARGE' | 'ROOM_NO_RULE',
    message: string,
  ) {
    super(message);
  }
}

/** The row with the latest effectiveFrom on or before `date` (dates as YYYY-MM-DD). */
export function inForce<T extends { effectiveFrom: string }>(
  rows: readonly T[],
  date: string,
): T | null {
  let best: T | null = null;
  for (const r of rows)
    if (r.effectiveFrom <= date && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  return best;
}

const money = (paise: bigint) => formatPaise(paise);
const rate = (r: string) => (Number(r) === 0 ? '0.00' : Number(r).toFixed(2));

export function lineSnapshot(i: LineSnapshotInput): LineSnapshot {
  const registration = inForce(i.registrations, i.serviceDate);
  const collection = taxCollection(registration?.registrationType ?? null);
  const unitPricePaise = toPaise(i.unitPrice);
  const discountSharePaise = toPaise(i.discountShare ?? '0');

  let base: Omit<
    LineSnapshot,
    'grossAmount' | 'discountShare' | 'taxableValue' | 'taxAmount' | 'lineTotal'
  >;
  if (i.kind === 'ROOM') {
    if (!i.room || i.room.dailyCharge === null)
      throw new LineSnapshotError('ROOM_NO_CHARGE', 'This room has no daily charge.');
    const rule = inForce(i.roomRules ?? [], i.serviceDate);
    if (!rule)
      throw new LineSnapshotError(
        'ROOM_NO_RULE',
        `No statutory room rule covers ${i.serviceDate}.`,
      );
    const critical = i.room.type === 'ICU' || i.room.criticalCareUnit !== null;
    const t = roomTreatment(toPaise(i.room.dailyCharge), critical, {
      thresholdPerDayPaise: toPaise(rule.thresholdPerDay),
      ratePercent: rule.ratePercent,
      sacCode: rule.sacCode,
      priceIncludesTax: rule.priceIncludesTax,
    });
    base = {
      unclassified: false,
      classificationId: null,
      classificationVersionId: null,
      classificationName: ROOM_LINE_NAME,
      hsnSac: rule.sacCode,
      supplyType: 'SERVICE',
      treatment: t.treatment,
      ratePercent: rate(t.ratePercent),
      priceIncludesTax: t.treatment === 'TAXABLE' ? rule.priceIncludesTax : false,
      gstCollected: collection.collect,
      notCollectedReason: collection.reason,
      roomRuleId: rule.id,
      roomDailyCharge: money(toPaise(i.room.dailyCharge)),
      roomCriticalCare: critical,
    };
  } else {
    const c = i.classification;
    const version = c && c.isActive ? inForce(c.versions, i.serviceDate) : null;
    if (!c || !version) {
      if (i.kind === 'OTHER')
        throw new LineSnapshotError(
          'CLASSIFICATION_UNUSABLE',
          `The chosen tax classification is inactive or has no rate in force on ${i.serviceDate}.`,
        );
      base = {
        unclassified: true,
        classificationId: null,
        classificationVersionId: null,
        classificationName: null,
        hsnSac: null,
        supplyType: null,
        treatment: null,
        ratePercent: null,
        priceIncludesTax: null,
        gstCollected: false,
        notCollectedReason: null,
        roomRuleId: null,
        roomDailyCharge: null,
        roomCriticalCare: null,
      };
    } else {
      base = {
        unclassified: false,
        classificationId: c.id,
        classificationVersionId: version.id,
        classificationName: c.name,
        hsnSac: c.hsnSac,
        supplyType: c.supplyType,
        treatment: version.treatment,
        ratePercent: rate(version.ratePercent),
        priceIncludesTax: version.priceIncludesTax,
        gstCollected: collection.collect,
        notCollectedReason: collection.reason,
        roomRuleId: null,
        roomDailyCharge: null,
        roomCriticalCare: null,
      };
    }
  }
  const t = lineTax({
    quantity: i.quantity,
    unitPricePaise,
    discountSharePaise,
    treatment: base.treatment ?? 'EXEMPT',
    ratePercent: base.ratePercent ?? '0',
    priceIncludesTax: base.priceIncludesTax ?? false,
    collectTax: !base.unclassified && base.gstCollected,
  });
  return {
    ...base,
    grossAmount: money(t.grossPaise),
    discountShare: money(discountSharePaise),
    taxableValue: money(t.taxablePaise),
    taxAmount: money(t.taxPaise),
    lineTotal: money(t.totalPaise),
  };
}

/** DEC-047 document type, as the finalise trigger decides it. */
export function documentTypeFor(
  registrationAtIssue: GstRegistrationType | null,
  lines: readonly Pick<LineSnapshot, 'gstCollected' | 'treatment'>[],
): 'TAX_INVOICE' | 'INVOICE_CUM_BILL_OF_SUPPLY' | 'BILL_OF_SUPPLY' {
  const taxed = lines.some((l) => l.gstCollected && l.treatment === 'TAXABLE');
  const untaxed = lines.some((l) => !(l.gstCollected && l.treatment === 'TAXABLE'));
  if (registrationAtIssue === 'REGULAR' && taxed)
    return untaxed ? 'INVOICE_CUM_BILL_OF_SUPPLY' : 'TAX_INVOICE';
  return 'BILL_OF_SUPPLY';
}
