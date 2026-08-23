import { getCurrentUser } from './api/auth.api';
import { getOrganizations } from './api/organizations.api';
//import { getMembers } from './api/memberships.api';
//import { getProjects } from './api/projects.api';

async function main() {
  console.log('User:', await getCurrentUser());
  console.log('Organizations:', await getOrganizations());
  //console.log('Members:', await getMembers("mockorganization"));
  //console.log('Projects:', await getProjects("mockorganization"));
}

main();
