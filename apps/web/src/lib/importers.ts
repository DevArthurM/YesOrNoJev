import { useDatasets } from "../store/datasets";
import { toast } from "../store/toasts";
import { ApiError } from "./api";
import { CsvError, parseCsvFile } from "./csv";

export async function importFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    try {
      const parsed = await parseCsvFile(file);
      await useDatasets.getState().addDataset({ name: file.name, ...parsed });
      toast(`added ${file.name} · ${parsed.rows.length} rows`);
    } catch (error) {
      const message = error instanceof CsvError || error instanceof ApiError ? error.message : `Could not read ${file.name}.`;
      toast(message, "error");
    }
  }
}
