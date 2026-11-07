// ---------------------------------------------------------------------------
// Full Google Drive location for a picked file — runs in the browser.
//
// A regular <input type="file"> can never tell a website which folder a file
// came from, but a file chosen through Google's Drive picker has an id we can
// look up: each Drive item lists its parent folder, so walking parent → parent
// up to the top gives the whole chain, e.g.
//
//   My Drive/Customers/Sugar Mill Taco Co/FRONT.pdf
//   Shared drives/Production/Sugar Mill Taco Co/FRONT.pdf
//
// which matches what staff see in drive.google.com and in Finder/Explorer
// under the Google Drive for desktop folder. Needs a token with the
// drive.metadata.readonly scope (names/folders only — no file contents).
// ---------------------------------------------------------------------------

type DriveItem = { id: string; name: string; parents?: string[]; driveId?: string; webViewLink?: string };

export type DriveLocation = { name: string; path: string; url: string };

const API = "https://www.googleapis.com/drive/v3";

async function getItem(id: string, token: string): Promise<DriveItem | null> {
  const res = await fetch(
    `${API}/files/${encodeURIComponent(id)}?fields=id,name,parents,driveId,webViewLink&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 404 || res.status === 403) return null; // not visible to this account
  if (!res.ok) throw new Error(`Google Drive lookup failed (${res.status}).`);
  return res.json();
}

async function sharedDriveName(driveId: string, token: string): Promise<string | null> {
  const res = await fetch(`${API}/drives/${encodeURIComponent(driveId)}?fields=name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()).name ?? null;
}

export async function resolveDriveLocation(fileId: string, token: string): Promise<DriveLocation> {
  const file = await getItem(fileId, token);
  if (!file) throw new Error("Couldn't read that file's location from Google Drive.");

  const root = await getItem("root", token); // the account's own "My Drive" root
  const folders: string[] = [];
  let top: string | null = null;
  let parentId = file.parents?.[0];

  // Walk up the folder chain (capped, in case of something unexpected).
  for (let i = 0; parentId && i < 40; i++) {
    if (root && parentId === root.id) {
      top = "My Drive";
      break;
    }
    const parent = await getItem(parentId, token);
    if (!parent) {
      // A folder above this point isn't visible to this account — the file
      // was shared with them from someone else's Drive.
      top = "Shared with me";
      break;
    }
    if (file.driveId && parent.id === file.driveId) {
      top = `Shared drives/${(await sharedDriveName(file.driveId, token)) ?? parent.name}`;
      break;
    }
    folders.unshift(parent.name);
    parentId = parent.parents?.[0];
  }
  if (!top) top = file.driveId ? `Shared drives/${(await sharedDriveName(file.driveId, token)) ?? "Shared drive"}` : file.parents?.length ? "My Drive" : "Shared with me";

  return {
    name: file.name,
    path: [top, ...folders, file.name].join("/"),
    url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
  };
}
