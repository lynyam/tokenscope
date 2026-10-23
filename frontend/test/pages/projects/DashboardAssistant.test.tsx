import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardAssistant } from '../../../src/pages/projects/DashboardAssistant';
import type { DashboardAssistantProps } from '../../../src/pages/projects/DashboardAssistant';
import { ApiError } from '../../../src/api/http-client';
import { clearAuthSession, getAccessToken, saveAccessToken } from '../../../src/api/auth-session';
import { AssistantStreamError } from '../../../src/api/assistant-stream';
import { askAssistant } from '../../../src/api/assistant.api';
import { readEvaluationFixture } from '../../api/helpers/evaluation-fixtures';

// Only the network call is replaced: validation and filter normalization stay real.
vi.mock('../../../src/api/assistant.api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/api/assistant.api')>()),
  askAssistant: vi.fn(),
}));

const context = JSON.parse(readEvaluationFixture('assistant/context.json'));

const selection = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-02T00:00:00.000Z',
  filters: {},
};

const props: DashboardAssistantProps = {
  organizationId: 'org-1',
  projectId: context.project.id,
  projectName: 'Support',
  selection,
  selectionState: 'ready',
};

const start = { type: 'start', data: { requestId: 'req-1', context } };
const delta = (text: string) => ({ type: 'delta', data: { text } });
const done = { type: 'done', data: { finishReason: 'stop', usage: null } };

/** A server answer that pauses after `start` until the test calls `release()`. */
function pausedAnswer() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  async function* events() {
    yield start;
    await gate;
    yield delta('Late text');
    yield done;
  }
  return { release, events };
}

let signals: AbortSignal[];

function mockAnswer(events: () => AsyncGenerator<unknown>) {
  vi.mocked(askAssistant).mockImplementation((async (input: { signal?: AbortSignal }) => {
    if (input.signal) signals.push(input.signal);
    return {
      stream: { body: new ReadableStream(), requestId: 'req-stream', isSessionCurrent: () => true, invalidateSession: vi.fn(clearAuthSession) },
      events: events(),
    };
  }) as never);
}

async function openPanel(overrides: Partial<DashboardAssistantProps> = {}) {
  const user = userEvent.setup();
  const view = render(<DashboardAssistant {...props} {...overrides} />);
  await user.click(screen.getByRole('button', { name: 'Ask assistant' }));
  return { user, ...view };
}

const type = (text: string) =>
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: text } });

beforeEach(() => {
  vi.mocked(askAssistant).mockReset();
  signals = [];
  saveAccessToken("session-a");
});

describe('DashboardAssistant', () => {
  it('opens from the launcher button and focuses the question field', async () => {
    await openPanel();
    expect(screen.getByRole('dialog', { name: 'Ask assistant' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your question')).toHaveFocus();
  });

  it('shows the project, the exact UTC period and the active filters', async () => {
    await openPanel({ selection: { ...selection, filters: { provider: 'openai' } } });
    expect(screen.getByText('Support')).toBeInTheDocument();
    expect(screen.getByText(/2026-10-01T00:00:00.000Z → 2026-10-02T00:00:00.000Z \(UTC\)/)).toBeInTheDocument();
    expect(screen.getByText('provider: openai')).toBeInTheDocument();
  });

  it('shows the answer, then "Answer complete."', async () => {
    mockAnswer(async function* () {
      yield start;
      yield delta('Hello ');
      yield delta('world');
      yield done;
    });
    const { user } = await openPanel();
    type('What did it cost?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('Hello world')).toBeInTheDocument();
    expect(await screen.findAllByText('Answer complete.')).toHaveLength(2);
    expect(askAssistant).toHaveBeenCalledTimes(1);
  });

  it('a double submit sends one request', async () => {
    const answer = pausedAnswer();
    mockAnswer(answer.events);
    await openPanel();
    type('What did it cost?');

    const form = screen.getByLabelText('Your question').closest('form')!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });

    expect(askAssistant).toHaveBeenCalledTimes(1);
    await act(async () => { answer.release(); });
  });

  it('Stop aborts the request, marks the answer incomplete and ignores late text', async () => {
    const answer = pausedAnswer();
    mockAnswer(answer.events);
    const { user } = await openPanel();
    type('What did it cost?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await user.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(signals[0].aborted).toBe(true);
    // Shown in the panel and repeated in the screen-reader live region.
    expect(screen.getAllByText('Stopped — answer incomplete')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();

    // The server keeps talking after Stop: nothing may appear.
    await act(async () => { answer.release(); });
    expect(screen.queryByText('Late text')).not.toBeInTheDocument();
    expect(screen.getAllByText('Stopped — answer incomplete')).toHaveLength(2);
  });

  it('can ask again after Stop', async () => {
    const answer = pausedAnswer();
    mockAnswer(answer.events);
    const { user } = await openPanel();
    type('First question');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await user.click(await screen.findByRole('button', { name: 'Stop' }));

    mockAnswer(async function* () { yield start; yield delta('Second answer'); yield done; });
    type('Second question');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('Second answer')).toBeInTheDocument();
    expect(askAssistant).toHaveBeenCalledTimes(2);
  });

  it('Close aborts the running request and shows the launcher again', async () => {
    const answer = pausedAnswer();
    mockAnswer(answer.events);
    const { user } = await openPanel();
    type('What did it cost?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByRole('button', { name: 'Stop' });

    await user.click(screen.getByRole('button', { name: 'Close assistant' }));

    expect(signals[0].aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask assistant' })).toBeInTheDocument();

    await act(async () => { answer.release(); });
    expect(screen.queryByText('Late text')).not.toBeInTheDocument();
  });

  it('Escape closes the panel', async () => {
    const { user } = await openPanel();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('an empty question shows a message and sends nothing', async () => {
    const { user } = await openPanel();
    type('   ');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(screen.getByText('Enter a question.')).toBeInTheDocument();
    expect(askAssistant).not.toHaveBeenCalled();
  });

  it('is blocked while the dashboard has no confirmed result for the selection', async () => {
    await openPanel({ selectionState: 'loading' });
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    expect(screen.getByText('Waiting for the dashboard to load this selection…')).toBeInTheDocument();
    expect(askAssistant).not.toHaveBeenCalled();
  });

  it('clears the previous answer when the period changes', async () => {
    mockAnswer(async function* () { yield start; yield delta('Old answer'); yield done; });
    const { user, rerender } = await openPanel();
    type('What did it cost?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Old answer')).toBeInTheDocument();

    rerender(
      <DashboardAssistant
        {...props}
        selection={{ ...selection, to: '2026-10-03T00:00:00.000Z' }}
      />,
    );

    await waitFor(() => expect(screen.queryByText('Old answer')).not.toBeInTheDocument());
  });

  it('aborts the running request when the page is left', async () => {
    const answer = pausedAnswer();
    mockAnswer(answer.events);
    const { user, unmount } = await openPanel();
    type('What did it cost?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByRole('button', { name: 'Stop' });

    unmount();

    expect(signals[0].aborted).toBe(true);
    await act(async () => { answer.release(); });
  });
});

it.each(['loading', 'empty', 'error', 'invalid'] as const)('blocks Ask for %s', async selectionState => {
  await openPanel({ selectionState });
  expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
});

it('keeps the fixed answer and context through a same-scope dashboard refresh', async () => {
  mockAnswer(async function* () { yield start; yield delta('Fixed answer'); yield done; });
  const { user, rerender } = await openPanel();
  type('Q');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByText('Fixed answer');
  rerender(<DashboardAssistant {...props} selection={{ ...selection, filters: {} }} selectionState="loading" />);
  expect(screen.getByText('Fixed answer')).toBeInTheDocument();
  expect(screen.getByText(context.generatedAt)).toBeInTheDocument();
  rerender(<DashboardAssistant {...props} selection={{ ...selection, filters: {} }} />);
  expect(screen.getByText('Fixed answer')).toBeInTheDocument();
  expect(askAssistant).toHaveBeenCalledTimes(1);
});

it('clears an active answer and ignores late text after applied filters change', async () => {
  const answer = pausedAnswer();
  mockAnswer(answer.events);
  const { user, rerender } = await openPanel();
  type('Q');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByRole('region', { name: 'Context used' });
  rerender(<DashboardAssistant {...props} selection={{ ...selection, filters: { workflow: 'support' } }} />);
  expect(signals[0].aborted).toBe(true);
  expect(screen.queryByRole('region', { name: 'Context used' })).not.toBeInTheDocument();
  await act(async () => answer.release());
  expect(screen.queryByText('Late text')).not.toBeInTheDocument();
});

it('ignores a late initial 404 from a superseded login', async () => {
  let reject!: (failure: Error) => void;
  vi.mocked(askAssistant).mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
  const unavailable = vi.fn();
  const { user } = await openPanel({ onProjectUnavailable: unavailable });
  type('Q');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  saveAccessToken('session-b');
  await act(async () => reject(new ApiError(404, 'PROJECT_NOT_FOUND', 'Not found')));
  expect(unavailable).not.toHaveBeenCalled();
  expect(getAccessToken()).toBe('session-b');
  expect(screen.queryByText('This project is no longer available.')).not.toBeInTheDocument();
  expect(screen.queryByText('Preparing answer…')).not.toBeInTheDocument();
});

it('clears completed protected content immediately on logout', async () => {
  mockAnswer(async function* () { yield start; yield delta('Private answer'); yield done; });
  const { user } = await openPanel();
  type('Private question');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByText('Private answer');
  act(() => clearAuthSession());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ask assistant' }));
  expect(screen.getByLabelText('Your question')).toHaveValue('');
  expect(screen.queryByText('Private answer')).not.toBeInTheDocument();
});

it.each(['PROJECT_NOT_FOUND', 'ACCESS_TOKEN_EXPIRED'])('clears partial content on streamed %s', async code => {
  const unavailable = vi.fn();
  mockAnswer(async function* () {
    yield start; yield delta('Protected answer');
    yield { type: 'error', data: { requestId: 'req-1', code, message: 'internal', retryable: false } };
  });
  const { user } = await openPanel({ onProjectUnavailable: unavailable });
  type('Q');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Context used' })).not.toBeInTheDocument());
  expect(screen.queryByText('Protected answer')).not.toBeInTheDocument();
  if (code === 'PROJECT_NOT_FOUND') {
    expect(unavailable).toHaveBeenCalledOnce();
    expect(getAccessToken()).toBe('session-a');
  } else expect(getAccessToken()).toBeNull();
});

it('keeps a partial answer incomplete and includes the stream request ID on read failure', async () => {
  mockAnswer(async function* () { yield start; yield delta('Partial text'); throw new AssistantStreamError('interrupted', 'EOF'); });
  const { user } = await openPanel();
  type('Q');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByText('Partial text');
  expect(await screen.findByText('Request ID: req-stream')).toBeInTheDocument();
  expect(screen.queryByText('Answer complete.')).not.toBeInTheDocument();
  expect(askAssistant).toHaveBeenCalledOnce();
});

it('preserves Retry-After through close/reopen and applied scope changes without auto retry', async () => {
  vi.mocked(askAssistant).mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'wait', undefined, 'req-rate', 60));
  const { user, rerender } = await openPanel();
  type('Q');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByText('Request ID: req-rate');
  expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Close assistant' }));
  rerender(<DashboardAssistant {...props} selection={{ ...selection, to: '2026-10-03T00:00:00.000Z' }} />);
  await user.click(screen.getByRole('button', { name: 'Ask assistant' }));
  expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  expect(askAssistant).toHaveBeenCalledOnce();
});

it('can Stop before headers and never display a late response', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof askAssistant>>) => void;
  vi.mocked(askAssistant).mockImplementation(input => {
    signals.push(input.signal!);
    return new Promise(done => { resolve = done; });
  });
  const { user } = await openPanel();
  type('Q');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(signals[0].aborted).toBe(true);
  const body = new ReadableStream<Uint8Array>();
  await act(async () => resolve({
    stream: { body, isSessionCurrent: () => true, invalidateSession: vi.fn() },
    events: (async function* () { throw new Error('Late stream must not be read'); })(),
  }));
  expect(screen.getAllByText('Stopped — answer incomplete')).toHaveLength(2);
});

it('shows controlled fragments before completion and treats output limits separately', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mockAnswer(async function* () {
    yield start; yield delta('<strong>First fragment</strong>');
    await gate;
    yield { type: 'done', data: { requestId: 'req-1', finishReason: 'length', usage: null } };
  });
  const { user, container } = await openPanel();
  type('Q');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByText('<strong>First fragment</strong>');
  expect(container.querySelector('strong')).toBeNull();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  expect(screen.getByLabelText('Your question')).toHaveAttribute('readonly');
  await act(async () => release());
  expect(screen.getAllByText('Answer reached the output limit and may be incomplete')).toHaveLength(2);
  expect(screen.queryByText('Answer complete.')).not.toBeInTheDocument();
});

it('does not let an older request cleanup unlock a newer one', async () => {
  const old = pausedAnswer();
  mockAnswer(old.events);
  const { user } = await openPanel();
  type('First');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  const next = pausedAnswer();
  mockAnswer(next.events);
  type('Second');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await act(async () => old.release());
  fireEvent.submit(screen.getByLabelText('Your question').closest('form')!);
  expect(askAssistant).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  await act(async () => next.release());
});

it.each([403, 503])('handles initial %s without invalidating the session', async status => {
  vi.mocked(askAssistant).mockRejectedValue(new ApiError(status, status === 403 ? 'FORBIDDEN' : 'LLM_UNAVAILABLE', '<unsafe internal>'));
  const { user } = await openPanel();
  type('My question');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findAllByText(status === 403 ? 'You no longer have access to this project.' : 'The assistant is currently unavailable.');
  expect(getAccessToken()).toBe('session-a');
  expect(screen.getByLabelText('Your question')).toHaveValue(status === 403 ? '' : 'My question');
  expect(screen.queryByText('<unsafe internal>')).not.toBeInTheDocument();
});
