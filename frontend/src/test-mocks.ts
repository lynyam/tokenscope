import { getCurrentUser } from './api/auth.api';
import { getOrganizations } from './api/organizations.api';
import { signIn } from './api/auth.api';
import { createOrganization } from './api/organizations.api';

async function main() {
  // Se connecter d'abord, sinon createOrganization échoue
  await signIn({ email: "alice@tokenscope.dev", password: "password123" });

  console.log('User:', await getCurrentUser());
  console.log('Organizations before:', await getOrganizations());

  const newOrg = await createOrganization({ name: "Test Org" });
  console.log('Created:', newOrg);

  console.log('Organizations after:', await getOrganizations());
}

main();