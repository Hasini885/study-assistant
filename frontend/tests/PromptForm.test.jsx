import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_CHARS, PromptForm } from '../src/components/PromptForm.jsx';

function setup(options) {
  const onSubmit = vi.fn();
  const user = userEvent.setup(options);
  const { container } = render(<PromptForm onSubmit={onSubmit} busy={false} />);
  const fileInput = container.querySelector('input[type="file"]');
  return { user, onSubmit, fileInput, textarea: screen.getByLabelText(/paste your notes/i) };
}

describe('PromptForm uploads', () => {
  test('an uploaded text file fills the field and reports its size', async () => {
    const { user, fileInput, textarea, onSubmit } = setup();
    await user.upload(fileInput, new File(['ATP is the energy currency.'], 'bio.txt', { type: 'text/plain' }));

    expect(await screen.findByText(/Extracted 27 characters from/)).toBeInTheDocument();
    expect(textarea).toHaveValue('ATP is the energy currency.');

    await user.click(screen.getByRole('button', { name: 'Generate study set' }));
    expect(onSubmit).toHaveBeenCalledWith({ input: 'ATP is the energy currency.' });
  });

  test('a file over the cap is loaded but blocked, with a way to trim it', async () => {
    const { user, fileInput, textarea } = setup();
    await user.upload(fileInput, new File(['x'.repeat(MAX_CHARS + 500)], 'long.md', { type: 'text/markdown' }));

    expect(await screen.findByText(/over the 20,000 limit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate study set' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /keep the first 20,000/ }));
    expect(textarea.value).toHaveLength(MAX_CHARS);
    expect(screen.getByRole('button', { name: 'Generate study set' })).toBeEnabled();
  });

  test('an unsupported file shows why', async () => {
    // The picker filters by type, but a drop or an "All files" choice doesn't.
    const { user, fileInput } = setup({ applyAccept: false });
    await user.upload(fileInput, new File(['x'], 'slides.pptx'));
    expect(await screen.findByText(/isn’t a supported type/)).toBeInTheDocument();
  });
});
