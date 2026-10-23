import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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


/** A server answer driven by the test: push events one by one, as the network would deliver them. */
function liveAnswer() {
  const queue: Array<{ type: string }> = [];
  let wake: (() => void) | null = null;
  async function* events() {
    for (;;) {
      while (queue.length > 0) {
        const event = queue.shift()!;
        yield event;
        if (event.type === 'done' || event.type === 'error') return;
      }
      await new Promise<void>(resolve => { wake = resolve; });
    }
  }
  const push = async (event: { type: string }) => {
    await act(async () => {
      queue.push(event);
      wake?.();
      wake = null;
    });
  };
  return { events, push };
}

/** jsdom has no layout: give the scrollable box a size and a position. */
function fakeScroll(box: HTMLElement, size: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  let top = size.scrollTop;
  Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => size.scrollHeight });
  Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => size.clientHeight });
  Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value; } });
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
    expect(screen.getAllByText('Stopped before an answer was received.')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();

    // The server keeps talking after Stop: nothing may appear.
    await act(async () => { answer.release(); });
    expect(screen.queryByText('Late text')).not.toBeInTheDocument();
    expect(screen.getAllByText('Stopped before an answer was received.')).toHaveLength(2);
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
  expect(screen.getAllByText('Stopped before an answer was received.')).toHaveLength(2);
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
  expect(screen.getByLabelText('Your question')).toHaveValue('');
  expect(screen.queryByText('<unsafe internal>')).not.toBeInTheDocument();
});

async function startLiveQuestion() {
  const answer = liveAnswer();
  mockAnswer(answer.events);
  const { user } = await openPanel();
  type('What did it cost?');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  return { answer, user };
}

it('keeps following the answer while the reader is at the bottom', async () => {
  const { answer } = await startLiveQuestion();
  await answer.push(start);
  await answer.push(delta('One'));
  const box = screen.getByTestId('assistant-messages');
  fakeScroll(box, { scrollHeight: 1000, clientHeight: 200, scrollTop: 800 });
  fireEvent.scroll(box);

  await answer.push(delta(' two'));

  expect(box.scrollTop).toBe(1000);
  expect(screen.queryByRole('button', { name: /New text below/ })).not.toBeInTheDocument();
});

it('does not move the view while the reader scrolled up, and offers a way back down', async () => {
  const { answer, user } = await startLiveQuestion();
  await answer.push(start);
  await answer.push(delta('One'));
  const box = screen.getByTestId('assistant-messages');
  fakeScroll(box, { scrollHeight: 1000, clientHeight: 200, scrollTop: 100 });
  fireEvent.scroll(box);

  await answer.push(delta(' two'));

  expect(box.scrollTop).toBe(100);
  const jump = await screen.findByRole('button', { name: /New text below/ });

  await user.click(jump);
  expect(box.scrollTop).toBe(1000);
  expect(screen.queryByRole('button', { name: /New text below/ })).not.toBeInTheDocument();

  // Back at the bottom: the next fragment is followed again.
  await answer.push(delta(' three'));
  expect(box.scrollTop).toBe(1000);
});

it('Stop still works while fragments are arriving', async () => {
  const { answer, user } = await startLiveQuestion();
  await answer.push(start);
  await answer.push(delta('Partial'));
  await screen.findByText('Partial');

  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(signals[0].aborted).toBe(true);

  await answer.push(delta(' after stop'));
  expect(screen.queryByText(/after stop/)).not.toBeInTheDocument();
  expect(screen.getByText('Partial')).toBeInTheDocument();
});

describe('resizing the panel', () => {
  async function openResizable() {
    const view = await openPanel();
    const dialog = screen.getByRole('dialog', { name: 'Ask assistant' });
    // jsdom has no layout: give the panel its default size.
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ width: 384, height: 544 } as DOMRect);
    return {
      ...view,
      dialog,
      leftEdge: screen.getByRole('button', { name: 'Resize assistant width' }),
      topEdge: screen.getByRole('button', { name: 'Resize assistant height' }),
      corner: screen.getByTestId('assistant-resize-corner'),
    };
  }

  const drag = (zone: HTMLElement, from: [number, number], to: [number, number]) => {
    fireEvent.pointerDown(zone, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: to[0], clientY: to[1] });
    fireEvent.pointerUp(zone, { pointerId: 1 });
  };

  it('has no visible handle mark', async () => {
    const { leftEdge, topEdge, corner } = await openResizable();
    for (const zone of [leftEdge, topEdge, corner]) expect(zone).toBeEmptyDOMElement();
  });

  it('dragging the left edge changes only the width', async () => {
    const { dialog, leftEdge } = await openResizable();
    drag(leftEdge, [500, 300], [450, 100]);
    expect(dialog).toHaveStyle({ width: '434px', height: '544px' });
  });

  it('dragging the top edge changes only the height', async () => {
    const { dialog, topEdge } = await openResizable();
    drag(topEdge, [500, 300], [400, 230]);
    expect(dialog).toHaveStyle({ width: '384px', height: '614px' });
  });

  it('dragging the corner changes both, in the diagonal', async () => {
    const { dialog, corner } = await openResizable();
    drag(corner, [500, 500], [450, 430]);
    expect(dialog).toHaveStyle({ width: '434px', height: '614px' });
  });

  it('shrinks when dragged toward the bottom-right', async () => {
    const { dialog, corner } = await openResizable();
    drag(corner, [500, 500], [540, 520]);
    expect(dialog).toHaveStyle({ width: '344px', height: '524px' });
  });

  it('stops following the pointer once released', async () => {
    const { dialog, leftEdge } = await openResizable();
    drag(leftEdge, [500, 300], [450, 300]);
    fireEvent.pointerMove(leftEdge, { pointerId: 1, clientX: 100, clientY: 300 });
    expect(dialog).toHaveStyle({ width: '434px' });
  });

  it('keyboard: the left edge handle changes the width, the top edge handle the height', async () => {
    const { dialog, leftEdge, topEdge } = await openResizable();

    fireEvent.keyDown(leftEdge, { key: 'ArrowLeft' });
    expect(dialog).toHaveStyle({ width: '408px', height: '544px' });
    fireEvent.keyDown(leftEdge, { key: 'ArrowUp' }); // not its axis
    expect(dialog).toHaveStyle({ width: '408px', height: '544px' });

    fireEvent.keyDown(topEdge, { key: 'ArrowUp' });
    expect(dialog).toHaveStyle({ width: '408px', height: '568px' });

    fireEvent.keyDown(leftEdge, { key: 'ArrowRight' });
    fireEvent.keyDown(topEdge, { key: 'ArrowDown' });
    expect(dialog).toHaveStyle({ width: '384px', height: '544px' });
  });

  it('never goes below the minimum or beyond the screen', async () => {
    const { dialog, corner, leftEdge, topEdge } = await openResizable();

    drag(corner, [0, 0], [2000, 2000]);
    expect(dialog).toHaveStyle({ width: '320px', height: '320px' });

    drag(corner, [2000, 2000], [-5000, -5000]);
    expect(dialog).toHaveStyle({
      width: window.innerWidth - 32 + 'px',
      height: window.innerHeight - 32 + 'px',
    });
    expect(leftEdge).toBeInTheDocument();
    expect(topEdge).toBeInTheDocument();
  });

  it('resets to the default size with Home or a double click', async () => {
    const { dialog, leftEdge, corner } = await openResizable();

    fireEvent.keyDown(leftEdge, { key: 'ArrowLeft' });
    fireEvent.keyDown(leftEdge, { key: 'Home' });
    expect(dialog.style.width).toBe('');
    expect(dialog.style.height).toBe('');

    drag(corner, [500, 500], [450, 430]);
    fireEvent.doubleClick(corner);
    expect(dialog.style.width).toBe('');
    expect(dialog.style.height).toBe('');
  });

  it('keeps the chosen size when the panel is closed and reopened', async () => {
    const { user, leftEdge } = await openResizable();
    fireEvent.keyDown(leftEdge, { key: 'ArrowLeft' });

    await user.click(screen.getByRole('button', { name: 'Close assistant' }));
    await user.click(screen.getByRole('button', { name: 'Ask assistant' }));

    expect(screen.getByRole('dialog', { name: 'Ask assistant' })).toHaveStyle({ width: '408px' });
  });

  it('ignores a right-click so it does not start a drag', async () => {
    const { dialog, corner } = await openResizable();
    fireEvent.pointerDown(corner, { button: 2, pointerId: 1, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(corner, { pointerId: 1, clientX: 400, clientY: 400 });
    expect(dialog.style.width).toBe('');
  });
});

describe('sending with the keyboard', () => {
  const field = () => screen.getByLabelText('Your question') as HTMLTextAreaElement;
  const quickAnswer = () => mockAnswer(async function* () { yield start; yield delta('The answer'); yield done; });

  it('Enter sends the question and empties the field', async () => {
    quickAnswer();
    await openPanel();
    type('What did it cost?');

    // fireEvent returns false when the default action (a new line) was cancelled.
    expect(fireEvent.keyDown(field(), { key: 'Enter' })).toBe(false);

    expect(askAssistant).toHaveBeenCalledTimes(1);
    expect(vi.mocked(askAssistant).mock.calls[0][0]).toMatchObject({ question: 'What did it cost?' });
    expect(await screen.findByText('The answer')).toBeInTheDocument();
    expect(field()).toHaveValue('');
  });

  it('shows the sent question in the conversation, not in the field', async () => {
    quickAnswer();
    await openPanel();
    type('What did it cost?');
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(await screen.findByText('What did it cost?')).toBeInTheDocument();
    expect(field()).toHaveValue('');
  });

  it('Shift+Enter keeps its new line and sends nothing', async () => {
    await openPanel();
    type('First line');

    expect(fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true })).toBe(true);

    expect(askAssistant).not.toHaveBeenCalled();
    expect(field()).toHaveValue('First line');
  });

  it('does not send while an input method is composing', async () => {
    await openPanel();
    type('こんにちは');

    expect(fireEvent.keyDown(field(), { key: 'Enter', isComposing: true })).toBe(true);

    expect(askAssistant).not.toHaveBeenCalled();
    expect(field()).toHaveValue('こんにちは');
  });

  it('Ctrl+Enter still sends', async () => {
    quickAnswer();
    await openPanel();
    type('What did it cost?');
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true });
    expect(askAssistant).toHaveBeenCalledTimes(1);
  });

  it('Enter on an empty field shows the message and sends nothing', async () => {
    await openPanel();
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(screen.getByText('Enter a question.')).toBeInTheDocument();
    expect(askAssistant).not.toHaveBeenCalled();
  });

  it('the field is ready for the next question after an answer', async () => {
    quickAnswer();
    await openPanel();
    type('First question');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await screen.findAllByText('Answer complete.');

    expect(field()).toHaveValue('');
    expect(field()).not.toHaveAttribute('readonly');

    quickAnswer();
    type('Second question');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(askAssistant).toHaveBeenCalledTimes(2));
  });

  it('keeps a failed question in its bubble and only Reuse question restores the draft', async () => {
    vi.mocked(askAssistant).mockRejectedValue(new ApiError(503, 'LLM_UNAVAILABLE', 'down'));
    await openPanel();
    type('My question');
    fireEvent.keyDown(field(), { key: 'Enter' });

    await screen.findAllByText('The assistant is currently unavailable.');
    expect(field()).toHaveValue('');
    expect(screen.getByText('My question')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reuse question' }));
    expect(field()).toHaveValue('My question');
    expect(field()).toHaveFocus();
    expect(askAssistant).toHaveBeenCalledTimes(1);
  });

  it('explains the keys under the field', async () => {
    await openPanel();
    expect(screen.getByText('Enter to send · Shift+Enter for a new line')).toBeInTheDocument();
  });
});

describe('expanding the panel', () => {
  const expandButton = () => screen.getByRole('button', { name: 'Expand assistant' });
  const collapseButton = () => screen.getByRole('button', { name: 'Collapse assistant' });
  const dialog = () => screen.getByRole('dialog', { name: 'Ask assistant' });

  it('toggles between Expand and Collapse', async () => {
    const { user } = await openPanel();
    expect(expandButton()).toHaveAttribute('aria-pressed', 'false');
    expect(dialog()).not.toHaveAttribute('data-expanded');

    await user.click(expandButton());
    expect(collapseButton()).toHaveAttribute('aria-pressed', 'true');
    expect(dialog()).toHaveAttribute('data-expanded', 'true');

    await user.click(collapseButton());
    expect(expandButton()).toBeInTheDocument();
    expect(dialog()).not.toHaveAttribute('data-expanded');
  });

  it('works from the keyboard and keeps the focus on the button', async () => {
    const { user } = await openPanel();
    const button = expandButton();
    button.focus();

    await user.keyboard('{Enter}');
    expect(dialog()).toHaveAttribute('data-expanded', 'true');
    expect(collapseButton()).toBe(button); // same element, only its label changed
    expect(button).toHaveFocus();

    await user.keyboard(' ');
    expect(dialog()).not.toHaveAttribute('data-expanded');
    expect(button).toHaveFocus();
  });

  it('keeps the text being typed', async () => {
    const { user } = await openPanel();
    type('A question being written');

    await user.click(expandButton());
    expect(screen.getByLabelText('Your question')).toHaveValue('A question being written');

    await user.click(collapseButton());
    expect(screen.getByLabelText('Your question')).toHaveValue('A question being written');
  });

  it('keeps the question, the answer, the context and the running stream, without a new request', async () => {
    const { answer, user } = await startLiveQuestion();
    await answer.push(start);
    await answer.push(delta('Partial answer'));
    await screen.findByText('Partial answer');

    await user.click(expandButton());

    expect(askAssistant).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(false);
    expect(screen.getByText('What did it cost?')).toBeInTheDocument(); // the question bubble
    expect(screen.getByText('Context used')).toBeInTheDocument();
    expect(screen.getByText('Partial answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    // The same stream keeps feeding the panel, and Collapse changes nothing either.
    await answer.push(delta(' continues'));
    expect(await screen.findByText('Partial answer continues')).toBeInTheDocument();
    await user.click(collapseButton());
    await answer.push(delta(' and ends'));
    await answer.push(done);

    expect(await screen.findByText('Partial answer continues and ends')).toBeInTheDocument();
    expect(askAssistant).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(false);
  });

  it('Stop still works while expanded', async () => {
    const { answer, user } = await startLiveQuestion();
    await answer.push(start);
    await answer.push(delta('Partial'));
    await screen.findByText('Partial');
    await user.click(expandButton());

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(signals[0].aborted).toBe(true);
  });

  it('leaves the expanded mode when the reader resizes by hand', async () => {
    const { user } = await openPanel();
    vi.spyOn(dialog(), 'getBoundingClientRect').mockReturnValue({ width: 900, height: 700 } as DOMRect);
    await user.click(expandButton());

    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize assistant width' }), { key: 'ArrowLeft' });

    expect(dialog()).not.toHaveAttribute('data-expanded');
    expect(dialog()).toHaveStyle({ width: '924px', height: '700px' });
    expect(expandButton()).toBeInTheDocument();
  });

  it('Home or a double click on a resize zone also collapses', async () => {
    const { user } = await openPanel();
    await user.click(expandButton());
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize assistant height' }), { key: 'Home' });
    expect(dialog()).not.toHaveAttribute('data-expanded');

    await user.click(expandButton());
    fireEvent.doubleClick(screen.getByTestId('assistant-resize-corner'));
    expect(dialog()).not.toHaveAttribute('data-expanded');
  });

  it('keeps the expanded state when the panel is closed and reopened, and Escape still closes', async () => {
    const { user } = await openPanel();
    await user.click(expandButton());

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ask assistant' }));
    expect(dialog()).toHaveAttribute('data-expanded', 'true');
  });
});

it('moves the question into its bubble immediately, before any accepted start', async () => {
  const { answer, user } = await startLiveQuestion();
  const field = screen.getByLabelText('Your question');
  expect(field).toHaveValue('');
  expect(field).toHaveAttribute('readonly');
  expect(screen.getByText('What did it cost?')).toBeInTheDocument();
  expect(screen.getAllByText('Preparing answer…')).toHaveLength(2);

  await answer.push(start);
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(field).toHaveValue('');
  expect(screen.getByText('What did it cost?')).toBeInTheDocument();
  expect(signals[0].aborted).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Reuse question' }));
  expect(field).toHaveValue('What did it cost?');
  expect(askAssistant).toHaveBeenCalledTimes(1);
  await answer.push(done); // drain the cancelled test generator
});

it('Stop before start keeps an empty composer and ignores late output', async () => {
  const { answer, user } = await startLiveQuestion();
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(screen.getByLabelText('Your question')).toHaveValue('');
  expect(screen.getByText('What did it cost?')).toBeInTheDocument();
  await answer.push(start);
  expect(screen.getByLabelText('Your question')).toHaveValue('');
  expect(screen.queryByText('Context used')).not.toBeInTheDocument();
  expect(askAssistant).toHaveBeenCalledTimes(1);
});

it('keeps exchanges in order with their own snapshots and sends no history', async () => {
  mockAnswer(async function* () { yield start; yield delta('First answer'); yield done; });
  const { user } = await openPanel();
  type('First question');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByText('First answer');
  const later = { ...context, generatedAt: '2026-10-23T15:00:00.000Z' };
  mockAnswer(async function* () {
    yield { ...start, data: { ...start.data, context: later } };
    yield delta('Second answer'); yield done;
  });
  type('Second question');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByText('Second answer');
  const exchanges = screen.getAllByRole('article', { name: 'Assistant exchange' });
  expect(exchanges).toHaveLength(2);
  expect(within(exchanges[0]).getByText('First question')).toBeInTheDocument();
  expect(within(exchanges[0]).getByText('First answer')).toBeInTheDocument();
  expect(within(exchanges[0]).getByText(context.generatedAt)).toBeInTheDocument();
  expect(within(exchanges[1]).getByText('Second answer')).toBeInTheDocument();
  expect(within(exchanges[1]).getByText(later.generatedAt)).toBeInTheDocument();
  expect(vi.mocked(askAssistant).mock.calls[1][0]).toEqual({
    organizationId: props.organizationId, projectId: props.projectId,
    question: 'Second question', selection, signal: expect.any(AbortSignal),
  });
  expect(screen.getByLabelText('Your question')).toHaveValue('');
});

it('retains a stopped partial exchange when the next question succeeds', async () => {
  const { answer, user } = await startLiveQuestion();
  await answer.push(start);
  await answer.push(delta('Partial first answer'));
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(screen.getByLabelText('Your question')).toHaveValue('');
  mockAnswer(async function* () { yield start; yield delta('New answer'); yield done; });
  type('New question');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByText('New answer');
  expect(screen.getByText('Partial first answer')).toBeInTheDocument();
  expect(screen.getByText('Stopped — answer incomplete')).toBeInTheDocument();
  await answer.push(delta('Late discarded fragment'));
  expect(screen.queryByText(/Late discarded/)).not.toBeInTheDocument();
});

it.each(['project', 'period', 'filters', 'logout', 'close', 'access loss'] as const)(
  'clears all exchanges on %s', async reason => {
    mockAnswer(async function* () { yield start; yield delta('Protected first'); yield done; });
    const { user, rerender } = await openPanel();
    type('First question');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText('Protected first');
    mockAnswer(async function* () { yield start; yield delta('Protected second'); yield done; });
    type('Second question');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText('Protected second');
    if (reason === 'project') rerender(<DashboardAssistant {...props} projectId="another-project" />);
    if (reason === 'period') rerender(<DashboardAssistant {...props} selection={{ ...selection, to: '2026-10-03T00:00:00.000Z' }} />);
    if (reason === 'filters') rerender(<DashboardAssistant {...props} selection={{ ...selection, filters: { status: 'ERROR' } }} />);
    if (reason === 'logout') act(() => clearAuthSession());
    if (reason === 'close') await user.click(screen.getByRole('button', { name: 'Close assistant' }));
    if (reason === 'access loss') {
      vi.mocked(askAssistant).mockRejectedValue(new ApiError(404, 'PROJECT_NOT_FOUND', 'gone'));
      type('Third question');
      await user.click(screen.getByRole('button', { name: 'Ask' }));
      await screen.findAllByText('This project is no longer available.');
    }
    expect(screen.queryByText('Protected first')).not.toBeInTheDocument();
    expect(screen.queryByText('Protected second')).not.toBeInTheDocument();
    expect(screen.queryByText('First question')).not.toBeInTheDocument();
    expect(screen.queryByText('Second question')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('region', { name: 'Context used' })).toHaveLength(0);
    if (reason === 'close') {
      await user.click(screen.getByRole('button', { name: 'Ask assistant' }));
      expect(screen.queryAllByRole('article')).toHaveLength(0);
    }
  },
);
