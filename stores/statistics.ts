// stores/statistics.ts
import { defineStore } from "pinia";
import { useTasksStore } from "./tasks";
import { useGoalsStore } from "./goals";

interface ActivityLog {
  date: string; // ISO string YYYY-MM-DD
  completedTasks: number;
  totalTasks: number;
}

interface TimeStats {
  time: string; // Morning, Afternoon, Evening, Night
  completed: number;
}

interface WeeklyProgressItem {
  day: string;
  completed: number;
}

export const useStatisticsStore = defineStore("statistics", {
  state: () => ({
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: "",
    activityLogs: [] as ActivityLog[],
    timeOfDayStats: [
      { time: "Morning", completed: 0 },
      { time: "Afternoon", completed: 0 },
      { time: "Evening", completed: 0 },
      { time: "Night", completed: 0 },
    ] as TimeStats[],
    isInitialized: false,
    syncQueue: [] as string[],
    // Add a property to cache previous week total
    _previousWeekTotal: 0,
    // Add a property to cache weekly progress
    _weeklyProgress: [] as WeeklyProgressItem[],
    // Cache for week-over-week change
    _weekOverWeekChange: 0,
    // Cache for most productive day
    _mostProductiveDay: "None",
  }),
  getters: {
    isLoggedIn() {
      try {
        const { loggedIn } = useUserSession();
        return loggedIn.value;
      } catch (error) {
        console.error("Error accessing user session:", error);
        return false;
      }
    },
    weeklyProgress(state): WeeklyProgressItem[] {
      if (state._weeklyProgress.length > 0) {
        return state._weeklyProgress;
      }

      const today = new Date();
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const result: WeeklyProgressItem[] = [];

      // Get data for the last 7 days
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const dateString = date.toISOString().split("T")[0];

        const dayLog = state.activityLogs.find(
          (log) => log.date === dateString
        );
        const dayIndex = date.getDay(); // 0 is Sunday, 6 is Saturday

        result.push({
          day: dayNames[dayIndex],
          completed: dayLog ? dayLog.completedTasks : 0,
        });
      }

      // Cache the result
      state._weeklyProgress = result;
      return result;
    },
    // Helper getter to calculate previous week total
    previousWeekTotal(state): number {
      // If already calculated, return cached value
      if (state._previousWeekTotal !== 0) {
        return state._previousWeekTotal;
      }

      const today = new Date();
      let prevWeekTotal = 0;

      // Get dates for previous week (7-13 days ago)
      for (let i = 13; i >= 7; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const dateString = date.toISOString().split("T")[0];

        const dayLog = state.activityLogs.find(
          (log) => log.date === dateString
        );
        if (dayLog) {
          prevWeekTotal += dayLog.completedTasks;
        }
      }

      // Cache the result
      state._previousWeekTotal = prevWeekTotal;
      return prevWeekTotal;
    },
    weekOverWeekChange(state): number {
      // If already calculated, return cached value
      if (state._weekOverWeekChange !== 0) {
        return state._weekOverWeekChange;
      }

      // Calculate current week total
      const thisWeek = this.weeklyProgress.reduce(
        (sum, day) => sum + day.completed,
        0
      );

      // Get previous week's data
      const prevWeekTotal = this.previousWeekTotal;

      if (prevWeekTotal === 0) return 0;
      const change = Math.round(
        ((thisWeek - prevWeekTotal) / prevWeekTotal) * 100
      );

      // Cache the result
      state._weekOverWeekChange = change;
      return change;
    },
    mostProductiveDay(state): string {
      // If already determined, return cached value
      if (state._mostProductiveDay !== "None") {
        return state._mostProductiveDay;
      }

      if (this.weeklyProgress.length === 0) return "None";

      const mostProductive = this.weeklyProgress.reduce((most, current) =>
        most.completed > current.completed ? most : current
      ).day;

      // Cache the result
      state._mostProductiveDay = mostProductive;
      return mostProductive;
    },
  },
  actions: {
    // Initialize statistics
    async initialize() {
      if (this.isInitialized) return;

      // Load from localStorage first (for backward compatibility)
      this.loadFromLocalStorage();

      // If logged in, sync with server
      if (this.isLoggedIn) {
        await this.fetchStatsFromServer();
      }

      // Update streak based on today's activity
      this.updateStreakInfo();

      this.isInitialized = true;
    },

    // Load data from localStorage
    loadFromLocalStorage() {
      const currentStreak = localStorage.getItem("currentStreak");
      const longestStreak = localStorage.getItem("longestStreak");
      const lastActiveDate = localStorage.getItem("lastActiveDate");
      const activityLogs = localStorage.getItem("activityLogs");
      const timeOfDayStats = localStorage.getItem("timeOfDayStats");

      if (currentStreak) this.currentStreak = parseInt(currentStreak);
      if (longestStreak) this.longestStreak = parseInt(longestStreak);
      if (lastActiveDate) this.lastActiveDate = lastActiveDate;
      if (activityLogs) {
        try {
          this.activityLogs = JSON.parse(activityLogs);
        } catch (e) {
          console.error("Error parsing activity logs:", e);
          this.activityLogs = [];
        }
      }
      if (timeOfDayStats) {
        try {
          this.timeOfDayStats = JSON.parse(timeOfDayStats);
        } catch (e) {
          console.error("Error parsing time of day stats:", e);
          this.timeOfDayStats = [
            { time: "Morning", completed: 0 },
            { time: "Afternoon", completed: 0 },
            { time: "Evening", completed: 0 },
            { time: "Night", completed: 0 },
          ];
        }
      }
    },

    // Save data to localStorage
    persistToLocalStorage() {
      localStorage.setItem("currentStreak", this.currentStreak.toString());
      localStorage.setItem("longestStreak", this.longestStreak.toString());
      localStorage.setItem("lastActiveDate", this.lastActiveDate);
      localStorage.setItem("activityLogs", JSON.stringify(this.activityLogs));
      localStorage.setItem(
        "timeOfDayStats",
        JSON.stringify(this.timeOfDayStats)
      );
    },

    // Fetch statistics from server
    async fetchStatsFromServer() {
      try {
        const response = await fetch("/api/statistics");

        if (!response.ok) {
          throw new Error("Failed to fetch statistics");
        }

        const data = await response.json();

        if (data.success) {
          this.currentStreak = data.currentStreak;
          this.longestStreak = data.longestStreak;
          this.lastActiveDate = data.lastActiveDate;
          this.activityLogs = data.activityLogs;
          this.timeOfDayStats = data.timeOfDayStats;

          // Reset cached values
          this._previousWeekTotal = 0;
          this._weeklyProgress = [];
          this._weekOverWeekChange = 0;
          this._mostProductiveDay = "None";

          // Clear localStorage once data is synced from server
          this.clearLocalStorageStats();
        }
      } catch (error) {
        console.error("Error fetching statistics:", error);
      }
    },

    // Save statistics to server
    async saveStatsToServer() {
      try {
        const { loggedIn } = useUserSession();
        if (!loggedIn.value) return;

        const statsData = {
          currentStreak: this.currentStreak,
          longestStreak: this.longestStreak,
          lastActiveDate: this.lastActiveDate,
          activityLogs: this.activityLogs,
          timeOfDayStats: this.timeOfDayStats,
        };

        const response = await fetch("/api/statistics", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(statsData),
        });

        if (!response.ok) {
          throw new Error("Failed to save statistics");
        }
      } catch (error) {
        console.error("Error saving statistics:", error);
        // Add to sync queue
        this.syncQueue.push("stats");
      }
    },

    // Process sync queue
    async processSyncQueue() {
      try {
        const { loggedIn } = useUserSession();
        if (!loggedIn.value || this.syncQueue.length === 0) return;

        this.syncQueue = [];
        await this.saveStatsToServer();
      } catch (error) {
        console.error("Error processing sync queue:", error);
      }
    },

    // Clear localStorage stats after server sync
    clearLocalStorageStats() {
      localStorage.removeItem("currentStreak");
      localStorage.removeItem("longestStreak");
      localStorage.removeItem("lastActiveDate");
      localStorage.removeItem("activityLogs");
      localStorage.removeItem("timeOfDayStats");
    },

    // Update streak information based on task completion
    updateStreakInfo() {
      const tasksStore = useTasksStore();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayString = today.toISOString().split("T")[0];

      // Check if any tasks completed today
      const tasksCompletedToday = tasksStore.tasks.some(
        (task) => task.completed
      );

      if (tasksCompletedToday) {
        // Update last active date to today
        this.lastActiveDate = todayString;

        // Update current streak
        if (!this.lastActiveDate) {
          // First time active
          this.currentStreak = 1;
        } else {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayString = yesterday.toISOString().split("T")[0];

          if (this.lastActiveDate === yesterdayString) {
            // Yesterday was active, increment streak
            this.currentStreak += 1;
          } else if (this.lastActiveDate === todayString) {
            // Already updated today, do nothing
          } else {
            // Break in streak, start over
            this.currentStreak = 1;
          }
        }

        // Update longest streak if needed
        if (this.currentStreak > this.longestStreak) {
          this.longestStreak = this.currentStreak;
        }

        // Update or create today's activity log
        this.updateActivityLog(todayString, tasksStore.tasks);

        // Update time of day stats
        this.updateTimeOfDayStats();

        // Reset cached values since data has changed
        this._previousWeekTotal = 0;
        this._weeklyProgress = [];
        this._weekOverWeekChange = 0;
        this._mostProductiveDay = "None";

        // Persist to local storage
        this.persistToLocalStorage();

        // Sync with server if logged in
        if (this.isLoggedIn) {
          this.saveStatsToServer();
        }
      }
    },

    // Update activity log for a specific date
    updateActivityLog(dateString: string, tasks: any[]) {
      const existingLogIndex = this.activityLogs.findIndex(
        (log) => log.date === dateString
      );
      const completedCount = tasks.filter((task) => task.completed).length;
      const totalCount = tasks.length;

      if (existingLogIndex !== -1) {
        this.activityLogs[existingLogIndex] = {
          date: dateString,
          completedTasks: completedCount,
          totalTasks: totalCount,
        };
      } else {
        this.activityLogs.push({
          date: dateString,
          completedTasks: completedCount,
          totalTasks: totalCount,
        });
      }

      // Keep only the last 30 days of logs
      if (this.activityLogs.length > 30) {
        this.activityLogs.sort((a, b) => a.date.localeCompare(b.date));
        this.activityLogs = this.activityLogs.slice(-30);
      }
    },

    // Update time of day stats
    updateTimeOfDayStats() {
      const hour = new Date().getHours();
      let timeCategory;

      if (hour >= 5 && hour < 12) {
        timeCategory = "Morning";
      } else if (hour >= 12 && hour < 17) {
        timeCategory = "Afternoon";
      } else if (hour >= 17 && hour < 22) {
        timeCategory = "Evening";
      } else {
        timeCategory = "Night";
      }

      const index = this.timeOfDayStats.findIndex(
        (stat) => stat.time === timeCategory
      );
      if (index !== -1) {
        this.timeOfDayStats[index].completed += 1;
      }
    },
  },
  persist: true,
});
