import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AssistantExchange } from '../../../src/pages/projects/AssistantExchange';
import { initialAssistantState, type AssistantState } from '../../../src/pages/projects/assistantState';
import { readEvaluationFixture } from '../../api/helpers/evaluation-fixtures';

const context = JSON.parse(readEvaluationFixture('assistant/context.json'));
const answer: AssistantState = { ...initialAssistantState, context, status: 'complete', text: 'Answer' };

it('collapses context by default and keeps the existing model disclosure accessible', async () => {
  const user = userEvent.setup();
  render(<AssistantExchange question="Q" answer={answer} onReuse={vi.fn()} reuseDisabled={false} />);
  const region = screen.getByRole('region', { name: 'Context used' });
  const details = region.querySelector('details')!;
  const cost = within(region).getByText('$0.01535');
  expect(details.open).toBe(false);
  expect(cost).not.toBeVisible();
  const summary = within(region).getByText('Context used');
  await user.click(summary);
  expect(details.open).toBe(true);
  expect(cost).toBeVisible();
  expect(within(region).getByText(context.generatedAt)).toBeVisible();
  const models = within(region).getByText('By provider / model');
  expect(models.closest('details')!.open).toBe(false);
  await user.click(models);
  expect(models.closest('details')!.open).toBe(true);
  await user.click(summary);
  expect(cost).not.toBeVisible();
});

it('renders bold, inline code, lists and partial Markdown without waiting for completion', () => {
  const text = '**Tokens:** 7200 for `demo-fast`.\n\n- First\n- Second';
  const { container, rerender } = render(<AssistantExchange question="**Literal question**"
    answer={{ ...answer, status: 'streaming', text }} onReuse={vi.fn()} reuseDisabled />);
  const body = screen.getByTestId('assistant-answer');
  expect(body.querySelector('strong')).toHaveTextContent('Tokens:');
  expect(body.querySelector('code')).toHaveTextContent('demo-fast');
  expect(within(body).getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByText('**Literal question**')).toBeInTheDocument();
  expect(screen.queryByText('Answer complete.')).not.toBeInTheDocument();
  rerender(<AssistantExchange question="Q" answer={{ ...answer, status: 'streaming', text: '**Partial' }} onReuse={vi.fn()} reuseDisabled />);
  expect(screen.getByTestId('assistant-answer')).toHaveTextContent('Partial');
  rerender(<AssistantExchange question="Q" answer={{ ...answer, text: '**Partial complete**' }} onReuse={vi.fn()} reuseDisabled={false} />);
  expect(container.querySelector('strong')).toHaveTextContent('Partial complete');
});

it('never creates executable HTML, images or links from model output', () => {
  const text = '<img src="https://example.invalid/tracker" onerror="alert(1)">\n\n'
    + '<script>alert(2)</script>\n\n[bad](javascript:alert) [external](https://example.invalid) '
    + '![remote](https://example.invalid/image.png)';
  const { container } = render(<AssistantExchange question="Q" answer={{ ...answer, text }} onReuse={vi.fn()} reuseDisabled={false} />);
  expect(container.querySelector('img, script, iframe, a')).toBeNull();
  expect(screen.getByTestId('assistant-answer')).toHaveTextContent('external');
  expect(screen.getByTestId('assistant-answer')).toHaveTextContent('<script>');
});
