// Delade auth-helpers. Kräver att supabaseClient-config.js laddats först.

async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = '/';
}

async function getCurrentMember() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabaseClient
    .from('members')
    .select('id, name, role')
    .eq('id', user.id)
    .single();

  if (error) return null;
  return data;
}

// Anropa i toppen av admin/medlem-sidor. requiredRole: 'admin' | 'medlem' | null (valfri roll)
async function requireAuth(requiredRole = null) {
  const member = await getCurrentMember();

  if (!member) {
    window.location.href = '/?login=required';
    return null;
  }

  if (requiredRole === 'admin' && member.role !== 'admin') {
    window.location.href = '/medlem/';
    return null;
  }

  return member;
}
