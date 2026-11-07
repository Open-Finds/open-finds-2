import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { user_metadata: {} } }, refreshProfile: vi.fn() }) }));
vi.mock('../lib/supabase', () => ({ checkUsernameAvailable: vi.fn(), upsertProfile: api.save }));
import { ChooseUsernamePage } from './ChooseUsername';
describe('generic profile examples', () => {
  it('renders generic placeholders as empty inputs and never auto-saves them', () => {
    render(<ChooseUsernamePage />);
    expect(screen.getByPlaceholderText('Alex Taylor')).toHaveValue('');
    expect(screen.getByPlaceholderText('alex.taylor')).toHaveValue('');
    expect(api.save).not.toHaveBeenCalled();
  });
});
