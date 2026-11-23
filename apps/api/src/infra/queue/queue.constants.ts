/**
 * Phase 0 registers one queue used to verify BullMQ connectivity in the health check.
 * Per-channel notification queues (email, sms, push), pdf, reports and reminders are
 * added in the phases that implement them (roadmap section 3, "Background jobs").
 */
export const SYSTEM_QUEUE = 'system';
