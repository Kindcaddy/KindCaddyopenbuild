"use client";

import Link from "next/link";
import { Sparkles, ArrowLeft, Home, Save } from "lucide-react";
import { useState } from "react";
import UserProfileDropdown from "@/components/UserProfileDropdown";

export default function ConfigurationPage() {
  const [chatStyle, setChatStyle] = useState("Concise and professional");
  const [memoryTrigger, setMemoryTrigger] = useState(
    "Capture stable user preferences and recurring business entities.",
  );
  const [memoryWeight, setMemoryWeight] = useState(
    "Prioritize recent prompts 60%, historical preferences 40%.",
  );
  const [frequentQuestions, setFrequentQuestions] = useState(
    "What invoices are overdue?\nWhich customer has the highest lifetime value?\nWhat changed in this tenant this week?",
  );
  const [saved, setSaved] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Navigation */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Sparkles className="h-8 w-8 text-blue-600" />
              <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">
                KindCaddy
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/app"
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
                title="Home"
              >
                <Home className="h-5 w-5" />
              </Link>
              <UserProfileDropdown />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          href="/app"
          className="inline-flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Link>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            System Settings
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            Configure how the chat agent responds and how memory points are extracted from user prompts.
          </p>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Chat style
              </label>
              <input
                value={chatStyle}
                onChange={(e) => setChatStyle(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="e.g. concise and friendly"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Agent memory points
              </label>
              <textarea
                value={memoryTrigger}
                onChange={(e) => setMemoryTrigger(e.target.value)}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="Define what user details should be remembered."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Memory scoring rule
              </label>
              <textarea
                value={memoryWeight}
                onChange={(e) => setMemoryWeight(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="How memory points are prioritized."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Frequent questions
              </label>
              <textarea
                value={frequentQuestions}
                onChange={(e) => setFrequentQuestions(e.target.value)}
                rows={5}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="One frequently asked question per line."
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Demo mode: changes are local and not persisted yet.
              </p>
              <button
                onClick={() => {
                  setSaved(true);
                  setTimeout(() => setSaved(false), 1800);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm"
              >
                <Save className="h-4 w-4" />
                {saved ? "Saved" : "Save settings"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
