import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/AuthForm';
import { AuthLayout } from '@/components/AuthLayout';
import { signInWithGitHub, signUp } from '@/app/auth/actions';
import { getCurrentUser } from '@/lib/supabase/server';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getCurrentUser()) redirect('/graphs');

  const { error } = await searchParams;

  return (
    <AuthLayout>
      <AuthForm
        mode="signup"
        action={signUp}
        githubAction={signInWithGitHub}
        {...(error ? { initialError: error } : {})}
      />
    </AuthLayout>
  );
}
