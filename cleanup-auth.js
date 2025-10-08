// Cleanup script for WhatsApp authentication files
const fs = require("fs");
const path = require("path");

const authDir = path.join(__dirname, ".wwebjs_auth");

function cleanupAuthFiles() {
  try {
    if (fs.existsSync(authDir)) {
      console.log("🧹 Cleaning up WhatsApp authentication files...");

      // Remove the entire auth directory
      fs.rmSync(authDir, { recursive: true, force: true });

      console.log("✅ Authentication files cleaned up successfully");
      console.log("💡 You can now restart the WhatsApp server safely");
    } else {
      console.log("✅ No authentication files found to clean up");
    }
  } catch (error) {
    console.error("❌ Error cleaning up authentication files:", error.message);
    console.log(
      "💡 Try running this script as administrator or manually delete the .wwebjs_auth folder"
    );
  }
}

// Run cleanup
cleanupAuthFiles();
