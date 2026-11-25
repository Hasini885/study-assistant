import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GroundingSummary, SourceBadge } from '../src/components/SourceBadge.jsx';

describe('SourceBadge', () => {
  test('a verified item shows the badge and its quote', () => {
    render(<SourceBadge item={{ grounded: true, source: 'ATP is the energy currency' }} />);
    expect(screen.getByText('From your notes')).toBeInTheDocument();
    expect(screen.getByText('ATP is the energy currency')).toBeInTheDocument();
  });

  test('an unverified item shows a quiet warning and no quote', () => {
    render(<SourceBadge item={{ grounded: false, source: 'made up' }} />);
    expect(screen.getByText('Not found in your notes')).toBeInTheDocument();
    expect(screen.queryByText('made up')).not.toBeInTheDocument();
  });

  test('an item from a bare topic shows nothing', () => {
    const { container } = render(<SourceBadge item={{ front: 'x' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('GroundingSummary', () => {
  test('summarises how many items were verified', () => {
    render(<GroundingSummary grounding={{ checked: 8, verified: 7 }} />);
    expect(screen.getByText(/7 of 8 items verified against your notes/)).toBeInTheDocument();
  });

  test('renders nothing without grounding data', () => {
    const { container } = render(<GroundingSummary grounding={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
