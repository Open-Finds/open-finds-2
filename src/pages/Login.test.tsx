import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { sendPasswordReset } from '../lib/supabase';
import { ChooseUsernamePage } from './ChooseUsername';
import { LoginPage } from './Login';

const mocks = vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://crpkzysdtnoomzimibhe.supabase.co');
  return {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    upsertProfile: vi.fn(),
    refreshProfile: vi.fn(),
    session: null as { user: { user_metadata: Record<string, string> } } | null,
  };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: mocks }) }));
vi.mock('../lib/supabase', async (original) => ({
  ...await original<typeof import('../lib/supabase')>(),
  checkUsernameAvailable: async () => true,
  fetchEnabledSignInProviders: async () => new Set(),
  upsertProfile: mocks.upsertProfile,
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ session: mocks.session, refreshProfile: mocks.refreshProfile }),
}));

const stagingHome = 'https://open-finds-2-bnuk-git-feature-ai-save-quick-share-date-planner.vercel.app/';

describe('staging email authentication', () => {
  it('waits for verification and preserves the profile choices for completion after sign-in', async () => {
    const user = userEvent.setup();
    mocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
    mocks.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    const login = render(<LoginPage />);
    await user.click(screen.getByRole('tab', { name: 'Sign Up' }));
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Test Person' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'test_person' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'tester@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
    fireEvent.submit(screen.getByLabelText('Password').closest('form')!);

    expect(await screen.findByRole('status')).toHaveTextContent(/return here and sign in/i);
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.upsertProfile).not.toHaveBeenCalled();
    const signup = mocks.signUp.mock.calls[0][0];
    expect(signup.options).toEqual({
      emailRedirectTo: stagingHome,
      data: { signup_display_name: 'Test Person', signup_username: 'test_person' },
    });

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'tester@example.test', password: 'test-password',
    });
    login.unmount();

    mocks.session = { user: { user_metadata: signup.options.data } };
    render(<ChooseUsernamePage />);
    expect(screen.getByLabelText('Display Name')).toHaveValue('Test Person');
    expect(screen.getByLabelText('Username')).toHaveValue('test_person');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(mocks.refreshProfile).toHaveBeenCalled());
    expect(mocks.upsertProfile).toHaveBeenCalledWith('Test Person', 'test_person');
  });

  it('sends password recovery to the browser instead of the APK origin', async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    await sendPasswordReset('tester@example.test');
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      'tester@example.test', { redirectTo: stagingHome },
    );
  });
});
