import fullWorker from "./worker-full.js";
import publicWorker from "./worker-public.js";

const LEAGUE_ID = "astbqxhwmk4b6bg9";
const WORKSPACE_ID = "pride-live";
const TEAM_NAME = "Capitol Carnage";

const fakeUser = {
  token_hash: "public-live",
  id: "public-live",
  username: "capitolcarnage",
  email: "",
  display_name: TEAM_NAME
};

const fakeWorkspace = {
  id: WORKSPACE_ID,
  user_id: