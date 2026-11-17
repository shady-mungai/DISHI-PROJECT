import { createRoot } from "react-dom/client";
import { useReaderDevice, useTapQueue } from "../../app/reader/useReader";
function ReaderQueueFixture() {
  const [device, setDevice] = useReaderDevice();
  const { queue, lastResults, flushError, enqueue } = useTapQueue(device);
  return (
    <main>
      <h1>Reader queue test fixture</h1>
      <button
        onClick={() =>
          setDevice({
            deviceRef: "test-reader",
            signingKeyHex: "ab".repeat(32),
          })
        }
      >
        Register test device
      </button>
      <p>Device: {device?.deviceRef ?? "none"}</p>
      <button onClick={() => enqueue("04a3b2c1d5e680")}>Queue a tap</button>
      <p role="status">Queued: {queue.length}</p>
      {flushError && <p role="alert">{flushError}</p>}
      <ul>
        {lastResults.map((result) => (
          <li key={result.eventId}>{result.status}</li>
        ))}
      </ul>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<ReaderQueueFixture />);
