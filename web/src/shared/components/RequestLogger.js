"use client";

import { useState, useEffect } from "react";
import Card from "./Card";

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchLogs(false);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const fetchLogs = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/request-logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Request Logs</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-text-muted flex items-center gap-2 cursor-pointer">
            <span>Auto Refresh (3s)</span>
            <div
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${autoRefresh ? "bg-primary" : "border border-white/10 bg-white/[0.04]"
                }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${autoRefresh ? "translate-x-5" : "translate-x-1"
                  }`}
              />
            </div>
          </label>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="p-0 overflow-x-auto max-h-[600px] overflow-y-auto font-mono text-xs">
          {loading && logs.length === 0 ? (
            <div className="p-8 text-center text-text-muted">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-text-muted">No logs recorded yet.</div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 z-10 border-b border-white/8 bg-[rgba(12,16,24,0.94)] backdrop-blur-md">
                <tr>
                  <th className="border-r border-white/8 px-3 py-2">DateTime</th>
                  <th className="border-r border-white/8 px-3 py-2">Model</th>
                  <th className="border-r border-white/8 px-3 py-2">Provider</th>
                  <th className="border-r border-white/8 px-3 py-2">Account</th>
                  <th className="border-r border-white/8 px-3 py-2">In</th>
                  <th className="border-r border-white/8 px-3 py-2">Out</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {logs.map((log, i) => {
                  const parts = log.split(" | ");
                  if (parts.length < 7) return null;

                  const status = parts[6];
                  const isPending = status.includes("PENDING");
                  const isFailed = status.includes("FAILED");
                  const isSuccess = status.includes("OK");

                  return (
                    <tr key={i} className={`hover:bg-primary/5 transition-colors ${isPending ? 'bg-primary/5' : ''}`}>
                      <td className="border-r border-white/8 px-3 py-1.5 text-text-muted">{parts[0]}</td>
                      <td className="border-r border-white/8 px-3 py-1.5 font-medium">{parts[1]}</td>
                      <td className="border-r border-white/8 px-3 py-1.5">
                        <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-bold uppercase">
                          {parts[2]}
                        </span>
                      </td>
                      <td className="max-w-[150px] truncate border-r border-white/8 px-3 py-1.5" title={parts[3]}>{parts[3]}</td>
                      <td className="border-r border-white/8 px-3 py-1.5 text-right text-primary">{parts[4]}</td>
                      <td className="border-r border-white/8 px-3 py-1.5 text-right text-success">{parts[5]}</td>
                      <td className={`px-3 py-1.5 font-bold ${isSuccess ? 'text-success' :
                          isFailed ? 'text-error' :
                            'text-primary animate-pulse'
                        }`}>
                        {status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      <div className="text-[10px] text-text-muted italic">
        Logs are loaded from the request history database.
      </div>
    </div>
  );
}
