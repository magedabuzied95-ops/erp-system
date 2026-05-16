import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, Loader2, LogIn, LogOut, MapPin, UserRound } from "lucide-react";

import { api } from "../../../shared/api/api";

const getCurrentPosition = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available on this device or browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => reject(error),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  });

const toRadians = (value) => (Number(value) * Math.PI) / 180;

const calculateDistanceMeters = (from, branch) => {
  const fromLat = Number(from?.latitude);
  const fromLon = Number(from?.longitude);
  const toLat = Number(branch?.latitude);
  const toLon = Number(branch?.longitude);
  if ([fromLat, fromLon, toLat, toLon].some((value) => !Number.isFinite(value))) return null;

  const earthRadius = 6371000;
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLon = toRadians(toLon - fromLon);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) *
      Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatMeters = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (number >= 1000) return `${(number / 1000).toFixed(2)} km`;
  return `${Math.round(number)} m`;
};

const formatDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export default function PublicBranchAttendance() {
  const { token } = useParams();
  const [branch, setBranch] = useState(null);
  const [identifier, setIdentifier] = useState("");
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [identifying, setIdentifying] = useState(false);
  const [submittingAction, setSubmittingAction] = useState("");
  const [locationStatus, setLocationStatus] = useState("idle");
  const [location, setLocation] = useState(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [serverGps, setServerGps] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadBranch = async () => {
      try {
        setLoading(true);
        setError("");
        const payload = await api.get(`/attendance/public/branch/${encodeURIComponent(token)}`);
        if (!active) return;
        setBranch(payload?.data || payload);
      } catch (err) {
        if (!active) return;
        setError(err?.message || "Attendance QR code is invalid or expired.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadBranch();
    return () => {
      active = false;
    };
  }, [token]);

  const requestLocation = async () => {
    try {
      setLocationStatus("loading");
      setLocationMessage("");
      const position = await getCurrentPosition();
      const nextLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setLocation(nextLocation);
      setLocationStatus("success");
    } catch (err) {
      setLocation(null);
      const denied = err?.code === 1;
      setLocationStatus(denied ? "denied" : "unavailable");
      setLocationMessage(denied ? "Location permission was denied." : err?.message || "Location is unavailable on this device.");
    }
  };

  useEffect(() => {
    if (!loading && branch) {
      queueMicrotask(() => {
        void requestLocation();
      });
    }
  }, [loading, branch]);

  const branchHasCoordinates = branch?.latitude !== null && branch?.latitude !== undefined && branch?.longitude !== null && branch?.longitude !== undefined;
  const localDistanceMeters = branchHasCoordinates && location ? calculateDistanceMeters(location, branch) : null;
  const allowedRadiusMeters = Number(branch?.attendance_radius_meters || 100);
  const isWithinRange = Number.isFinite(localDistanceMeters) ? localDistanceMeters <= allowedRadiusMeters : null;
  const attendanceState = employee?.attendance_state || null;
  const canCheckIn = Boolean(attendanceState?.can_check_in);
  const canCheckOut = Boolean(attendanceState?.can_check_out);
  const attendanceCompleted = Boolean(attendanceState?.completed);

  const identifyEmployee = async (event) => {
    event.preventDefault();
    if (!identifier.trim()) return;

    try {
      setIdentifying(true);
      setError("");
      setMessage("");
      const payload = await api.post(`/attendance/public/branch/${encodeURIComponent(token)}/identify`, {
        identifier: identifier.trim(),
      });
      setEmployee(payload?.data || payload);
    } catch (err) {
      setEmployee(null);
      setError(err?.message || "Employee not found.");
    } finally {
      setIdentifying(false);
    }
  };

  const recordAttendance = async (actionType) => {
    if (!employee?.employee_id) return;

    try {
      setSubmittingAction(actionType);
      setError("");
      setMessage("");
      setServerGps(null);

      const payload = await api.post(`/attendance/public/branch/${encodeURIComponent(token)}/actions`, {
        employee_id: employee.employee_id,
        action_type: actionType,
        ...(location || {}),
      });
      const data = payload?.data || {};
      setServerGps(data?.gps || null);
      if (data?.attendance_state) {
        setEmployee((prev) => (prev ? { ...prev, attendance_state: data.attendance_state } : prev));
      }
      setMessage(`${payload?.message || "Attendance recorded"}${data.timestamp ? ` at ${formatDateTime(data.timestamp)}` : ""}`);
    } catch (err) {
      setServerGps(err?.gps || err?.responseBody?.gps || null);
      const nextState = err?.attendance_state || err?.responseBody?.attendance_state;
      if (nextState) {
        setEmployee((prev) => (prev ? { ...prev, attendance_state: nextState } : prev));
      }
      setError(err?.message || "Failed to record attendance.");
    } finally {
      setSubmittingAction("");
    }
  };

  return (
    <main className="min-h-screen bg-[#f6f7f9] text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 py-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/70">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
              <Clock className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Attendance</div>
              <h1 className="truncate text-2xl font-black">{loading ? "Loading..." : branch?.branch_name || "Branch check-in"}</h1>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Enter your phone number or employee code to record attendance for this branch.
          </div>

          {branchHasCoordinates ? (
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <iframe
                title="Branch map preview"
                className="h-36 w-full border-0"
                loading="lazy"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(branch.longitude) - 0.002}%2C${Number(branch.latitude) - 0.002}%2C${Number(branch.longitude) + 0.002}%2C${Number(branch.latitude) + 0.002}&layer=mapnik&marker=${Number(branch.latitude)}%2C${Number(branch.longitude)}`}
              />
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              {locationStatus === "loading" ? <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-slate-500" /> : null}
              {locationStatus === "success" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : null}
              {["denied", "unavailable"].includes(locationStatus) ? <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" /> : null}
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Location</div>
                <div className="mt-1 text-sm font-bold text-slate-800">
                  {locationStatus === "loading" ? "Loading your location..." : null}
                  {locationStatus === "success" ? "Location permission granted." : null}
                  {locationStatus === "denied" ? "Location permission denied." : null}
                  {locationStatus === "unavailable" ? "GPS is unavailable on this device or browser." : null}
                  {locationStatus === "idle" ? "Waiting for location permission..." : null}
                </div>
                {branchHasCoordinates && locationStatus === "success" && Number.isFinite(localDistanceMeters) ? (
                  <div className={`mt-2 text-sm font-black ${isWithinRange ? "text-emerald-700" : "text-red-700"}`}>
                    {isWithinRange ? "You are within branch range" : "You are outside allowed range"}
                  </div>
                ) : null}
                {branchHasCoordinates && Number.isFinite(localDistanceMeters) ? (
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    Distance from branch: {formatMeters(localDistanceMeters)}. Allowed radius: {formatMeters(allowedRadiusMeters)}.
                  </div>
                ) : null}
                {locationMessage ? <div className="mt-1 text-xs font-semibold text-amber-700">{locationMessage}</div> : null}
                {locationStatus !== "loading" ? (
                  <button
                    type="button"
                    onClick={requestLocation}
                    className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-xs font-black text-slate-700"
                  >
                    Retry location
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <form className="mt-5 space-y-3" onSubmit={identifyEmployee}>
            <label>
              <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">Phone or employee code</div>
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                disabled={loading || identifying}
                autoComplete="off"
                inputMode="text"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-4 text-base font-semibold outline-none transition focus:border-slate-950"
              />
            </label>
            <button
              type="submit"
              disabled={loading || identifying || !identifier.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserRound className="h-4 w-4" />
              {identifying ? "Finding employee..." : "Continue"}
            </button>
          </form>

          {employee ? (
            <section className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-1 h-5 w-5 text-emerald-700" />
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">Employee identified</div>
                  <div className="mt-1 text-xl font-black text-slate-950">{employee.employee_name}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-600">{employee.employee_code}</div>
                </div>
              </div>

              {attendanceState ? (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-white/70 p-3 text-sm font-bold text-slate-700">
                  {attendanceState.status === "not_started" ? "No attendance recorded today." : null}
                  {attendanceState.status === "checked_in" ? "Checked in. Check out is available." : null}
                  {attendanceCompleted ? "Attendance completed" : null}
                </div>
              ) : null}

              <div className="mt-4 grid gap-3">
                {canCheckIn ? (
                  <button
                    type="button"
                    onClick={() => recordAttendance("check_in")}
                    disabled={Boolean(submittingAction) || locationStatus === "loading"}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-4 text-sm font-black text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <LogIn className="h-4 w-4" />
                    {submittingAction === "check_in" ? "Saving..." : "Check In"}
                  </button>
                ) : null}
                {canCheckOut ? (
                  <button
                    type="button"
                    onClick={() => recordAttendance("check_out")}
                    disabled={Boolean(submittingAction) || locationStatus === "loading"}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    <LogOut className="h-4 w-4" />
                    {submittingAction === "check_out" ? "Saving..." : "Check Out"}
                  </button>
                ) : null}
              </div>

              <div className="mt-3 flex items-start gap-2 text-xs font-semibold text-slate-600">
                <MapPin className="mt-0.5 h-3.5 w-3.5" />
                Backend GPS verification is required when this branch has coordinates.
              </div>
            </section>
          ) : null}

          {serverGps ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">
              Server GPS result: {serverGps.verification_result || "-"}
              {serverGps.distance_meters !== null && serverGps.distance_meters !== undefined ? `, distance ${formatMeters(serverGps.distance_meters)}` : ""}
            </div>
          ) : null}

          {message ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{message}</div> : null}
          {error ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
        </section>
      </div>
    </main>
  );
}
