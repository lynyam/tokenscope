import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { DashboardAssistant } from '../../../src/pages/projects/DashboardAssistant';
import { apiPostStream } from '../../../src/api/http-client';
import { saveAccessToken } from '../../../src/api/auth-session';
import { readEvaluationFixture } from '../../api/helpers/evaluation-fixtures';

// Keep askAssistant, scope validation, UTF-8 decoding, SSE parsing and the reducer
// real. Only the HTTP transport is replaced with a controllable unread body.
vi.mock('../../../src/api/http-client', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/api/http-client')>()),
  apiPostStream: vi.fn(),
}));

const context = JSON.parse(readEvaluationFixture('assistant/context.json'));
const requestId = 'progressive-ui';
const encode = (event: string, data: unknown) => new TextEncoder().encode(
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
);

beforeEach(() => {
  vi.mocked(apiPostStream).mockReset();
  saveAccessToken('synthetic-session');
});

async function openStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let signal: AbortSignal | undefined;
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel: cancelled,
  });
  vi.mocked(apiPostStream).mockImplementation(async (_path, _body, options) => {
    signal = options?.signal;
    signal?.addEventListener('abort', () => {
      controller.error(new DOMException('Stopped', 'AbortError'));
    }, { once: true });
    return { body, requestId, isSessionCurrent: () => true, invalidateSession: vi.fn() };
  });
  const user = userEvent.setup();
  render(<DashboardAssistant
    organizationId="org"
    projectId={context.project.id}
    projectName={context.project.name}
    selection={{ from: context.window.from, to: context.window.to, filters: context.filters }}
    selectionState="ready"
  />);
  await user.click(screen.getByRole('button', { name: 'Ask assistant' }));
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Explain the costs' } });
  await user.click(screen.getByRole('button', { name: /^Ask$/ }));
  const push = async (bytes: Uint8Array) => {
    await act(async () => { controller.enqueue(bytes); });
  };
  await push(encode('start', { requestId, provider: 'gemini', model: 'fixture-model', context }));
  return { user, push, cancelled, signal: () => signal };
}

it('renders complete SSE fragments before done and keeps the same stream while expanding', async () => {
  const { user, push } = await openStream();
  expect(screen.getByLabelText('Your question')).toHaveValue('');

  // An incomplete network chunk cannot render half a JSON frame.
  const first = encode('delta', { text: 'First visible fragment' });
  await push(first.slice(0, -1));
  expect(screen.queryByText('First visible fragment')).not.toBeInTheDocument();
  await push(first.slice(-1));
  expect(await screen.findByText('First visible fragment')).toBeInTheDocument();
  expect(screen.queryByText('Answer complete.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Expand assistant' }));
  await push(encode('delta', { text: ' — second fragment' }));
  expect(await screen.findByText('First visible fragment — second fragment')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Collapse assistant' }));
  expect(apiPostStream).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('region', { name: 'Context used' })).toBeInTheDocument();

  await push(encode('done', { requestId, finishReason: 'stop', usage: null }));
  expect(await screen.findAllByText('Answer complete.')).toHaveLength(2);
  expect(apiPostStream).toHaveBeenCalledTimes(1);
});

it('Stop aborts a pending body read and keeps the already visible partial answer', async () => {
  const { user, push, signal } = await openStream();
  await push(encode('delta', { text: 'Partial answer' }));
  expect(await screen.findByText('Partial answer')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Expand assistant' }));
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(signal()?.aborted).toBe(true);
  expect(screen.getByText('Partial answer')).toBeInTheDocument();
  expect(screen.getAllByText('Stopped — answer incomplete')).toHaveLength(2);
  expect(screen.queryByText('Answer complete.')).not.toBeInTheDocument();
  expect(apiPostStream).toHaveBeenCalledTimes(1);
});
