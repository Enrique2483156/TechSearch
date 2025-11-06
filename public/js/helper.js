// for fetching get parametres from url : https://techfinder.geeksonsite.com?=${Users.User Id}&=${Users.Role}&=${Organization.Organization Id}
// perhaps not send an Org-Id only user Id and generated Access Key
// helper.js

export function getUrlContext() {
  const sp = new URLSearchParams(window.location.search);
  const userId = sp.get('uid') || null;
  const orgId = sp.get('org') || null;

  if (!userId || !orgId) {
   
    document.body.innerHTML = `
      <div style="padding:2rem; color:red; font-family:sans-serif;">
        Missing required parameters in URL. Please open this page inside Zoho CRM.
      </div>
    `;
    throw new Error('Missing uid or org in URL');
  }
  console.log(userId);
  return { userId, orgId };
}


export function loadUrlContext() {
  const ctx = getUrlContext();
  // делаем видимым глобально (или можешь экспортировать и передавать явно)
  window.APP_CTX = ctx;
  window.appUserId = ctx.userId;
  window.appOrgId = ctx.orgId;
  return ctx;
}

export async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const { userId, orgId } = window.APP_CTX || getUrlContext();

  if (userId) headers.set('X-User-Id', userId);
  if (orgId) headers.set('X-Org-Id', orgId);
  // console.log(orgId);
  return fetch(url, { ...options, headers });
}
