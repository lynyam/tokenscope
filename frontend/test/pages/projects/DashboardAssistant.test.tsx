import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardAssistant } from '../../../src/pages/projects/DashboardAssistant';
import type { DashboardAssistantProps } from '../../../src/pages/projects/DashboardAssistant';
import { askAssistant } from '../../../src/api/assistant.api';
import { readFixture } from '../../api/helpers/fixtures';

// Only the network call is replaced: validation and filter normalization stay real.
vi.mock('../../../src/api/assistant.api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/api/assistant.api')>()),
  askAssistant: vi.fn(),
}));

const context = JSON.parse(readFixture('context.json'));

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
      stream: { isSessionCurrent: () => true, invalidateSession: vi.fn() },
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
    expect(await screen.findByText('Answer complete.')).toBeInTheDocument();
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