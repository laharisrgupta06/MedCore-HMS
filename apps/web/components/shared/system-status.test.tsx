import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemStatus } from './system-status';

const healthy = {
  status: 'ok',
  db: 'up',
  redis: 'up',
  queue: 'up',
  uptimeSeconds: 5,
  timestamp: 't',
};

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SystemStatus />
    </QueryClientProvider>,
  );
}

const mockFetch = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('SystemStatus', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows a loading state, then every service as up', async () => {
    mockFetch(200, { success: true, data: healthy, message: 'OK' });
    renderWithClient();
    expect(screen.getByRole('status')).toHaveTextContent('Checking services');
    expect(await screen.findByText('All services are running.')).toBeInTheDocument();
    expect(screen.getAllByText('Up')).toHaveLength(3);
  });

  it('shows which dependency is down and lets the user retry', async () => {
    const spy = mockFetch(503, {
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'One or more dependencies are unavailable.',
        details: { ...healthy, status: 'degraded', redis: 'down' },
      },
    });
    renderWithClient();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'One or more dependencies are unavailable.',
    );
    expect(screen.getByText('Down')).toBeInTheDocument();
    spy.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: healthy, message: 'OK' }), {
        status: 200,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('All services are running.')).toBeInTheDocument();
  });

  it('explains a network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    renderWithClient();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
  });
});
