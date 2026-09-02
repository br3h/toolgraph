import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/AuthForm';
import { AuthLayout } from '@/components/AuthLayout';
import { signIn, signInWithGitHub } from '@/app/auth/actions';
import { getCurrentUser } from '@/lib/supabase/server';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Someone already signed in has no business on the sign-in page.
  if (await getCurrentUser()) redirect('/graphs');

  const { error } = await searchParams;

  return (
    <AuthLayout>
      <AuthForm
        mode="login"
        action={signIn}
        githubAction={signInWithGitHub}
        {...(error ? { initialError: error } : {})}
      />
    </AuthLayout>
  );
}
