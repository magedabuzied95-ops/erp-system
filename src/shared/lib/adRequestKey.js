// The account, date window, level and filters all belong to the snapshot key.
export const adRequestKey = (path) => {
  const url = new URL(path, 'https://erp.local');
  url.searchParams.sort();
  return `${url.pathname.split('/')[1]}:${url.pathname}${url.search}`;
};
