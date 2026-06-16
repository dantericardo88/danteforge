# Windows shim for the Unix-only `resource` stdlib module (CH-033). The official swebench harness
# imports `resource` on the HOST to raise rlimits before spawning per-instance DOCKER containers.
# The real grading happens inside Linux containers (which have the real module), so stubbing the
# host-side rlimit calls as no-ops is safe for small runs and does not touch grading correctness.
RLIMIT_NOFILE = 7
RLIMIT_NPROC = 6
RLIMIT_AS = 9
RLIMIT_STACK = 3
RLIM_INFINITY = -1
def getrlimit(_res):
    return (RLIM_INFINITY, RLIM_INFINITY)
def setrlimit(_res, _limits):
    return None
def getrusage(_who=0):
    class _R:  # minimal struct_rusage stand-in
        ru_maxrss = 0
        ru_utime = 0.0
        ru_stime = 0.0
    return _R()
RUSAGE_SELF = 0
RUSAGE_CHILDREN = -1
