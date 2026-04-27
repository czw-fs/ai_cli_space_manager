package terminal

import (
	"errors"
	"unsafe"

	pty "github.com/aymanbagabas/go-pty"
	"golang.org/x/sys/windows"
)

func killProcessTree(cmd *pty.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	pids, err := descendantProcessIDs(uint32(cmd.Process.Pid))
	if err != nil {
		return err
	}

	var errs []error
	for i := len(pids) - 1; i >= 0; i-- {
		if err := terminateProcess(pids[i]); err != nil {
			errs = append(errs, err)
		}
	}
	if err := terminateProcess(uint32(cmd.Process.Pid)); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

func descendantProcessIDs(rootPID uint32) ([]uint32, error) {
	parentToChildren, err := processParentMap()
	if err != nil {
		return nil, err
	}

	var pids []uint32
	var walk func(parent uint32)
	walk = func(parent uint32) {
		for _, child := range parentToChildren[parent] {
			walk(child)
			pids = append(pids, child)
		}
	}
	walk(rootPID)
	return pids, nil
}

func processParentMap() (map[uint32][]uint32, error) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snapshot)

	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	if err := windows.Process32First(snapshot, &entry); err != nil {
		return nil, err
	}

	parentToChildren := map[uint32][]uint32{}
	for {
		parentToChildren[entry.ParentProcessID] = append(parentToChildren[entry.ParentProcessID], entry.ProcessID)
		entry.Size = uint32(unsafe.Sizeof(windows.ProcessEntry32{}))
		if err := windows.Process32Next(snapshot, &entry); err != nil {
			break
		}
	}
	return parentToChildren, nil
}

func terminateProcess(pid uint32) error {
	handle, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, pid)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(handle)
	return windows.TerminateProcess(handle, 1)
}
