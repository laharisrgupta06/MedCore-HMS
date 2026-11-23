import type {
  AccountantSummaryView,
  CheckoutStarted,
  InvoicePaymentsView,
  MyPaymentView,
  OnlinePaymentMethod,
  PaymentDetailView,
  PaymentMethod,
  ReceiptEmailResult,
  ReconciliationState,
  ReconciliationView,
  TestCheckoutOutcome,
} from '@medcore/types';
import { apiBlob, apiRequest, qs } from '@/lib/api-client';

/** Payments (8-B5 cash, reversal, receipts, reconciliation; 8-B6 online checkout). The API enforces every rule. */
export const paymentsApi = {
  forInvoice: (invoiceId: string) =>
    apiRequest<InvoicePaymentsView>(`/invoices/${invoiceId}/payments`),
  cash: (invoiceId: string, amount: string) =>
    apiRequest<InvoicePaymentsView>(`/invoices/${invoiceId}/payments/cash`, {
      method: 'POST',
      json: { amount },
    }),
  checkout: (invoiceId: string, method: OnlinePaymentMethod) =>
    apiRequest<CheckoutStarted>(`/invoices/${invoiceId}/payments/checkout`, {
      method: 'POST',
      json: { method },
    }),
  get: (paymentId: string) => apiRequest<PaymentDetailView>(`/payments/${paymentId}`),
  cancel: (paymentId: string) =>
    apiRequest<PaymentDetailView>(`/payments/${paymentId}/cancel`, { method: 'POST', json: {} }),
  simulate: (paymentId: string, outcome: TestCheckoutOutcome) =>
    apiRequest<PaymentDetailView>(`/payments/${paymentId}/simulate`, {
      method: 'POST',
      json: { outcome },
    }),
  reverse: (paymentId: string, reason: string) =>
    apiRequest<PaymentDetailView>(`/payments/${paymentId}/reverse`, {
      method: 'POST',
      json: { reason },
    }),
  mine: () => apiRequest<MyPaymentView[]>('/payments/mine'),
  receiptBlob: (paymentId: string) => apiBlob(`/payments/${paymentId}/receipt`),
  emailReceipt: (paymentId: string) =>
    apiRequest<ReceiptEmailResult>(`/payments/${paymentId}/receipt/email`, {
      method: 'POST',
      json: {},
    }),
  reconciliation: (q: {
    from: string;
    to: string;
    method?: PaymentMethod;
    state?: ReconciliationState;
  }) => apiRequest<ReconciliationView>(`/reconciliation${qs(q)}`),
  markReconciled: (paymentIds: string[]) =>
    apiRequest<{ marked: number }>('/reconciliation/mark', {
      method: 'POST',
      json: { paymentIds },
    }),
  summary: () => apiRequest<AccountantSummaryView>('/billing/summary'),
};
